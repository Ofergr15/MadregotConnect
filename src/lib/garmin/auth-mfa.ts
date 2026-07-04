import axios, { AxiosInstance } from 'axios';
import qs from 'qs';
import crypto from 'crypto';

const CSRF_RE = /name="_csrf"\s+value="(.+?)"/;
const TICKET_RE = /ticket=([^"&\s]+)/;
const MFA_RE = /id="verification-code"|name="verificationCode"|MFA Challenge/i;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';
const OAUTH_CONSUMER_URL = 'https://thegarth.s3.amazonaws.com/oauth_consumer.json';

const SSO_ORIGIN = 'https://sso.garmin.com';
const SSO_EMBED = `${SSO_ORIGIN}/sso/embed`;
const SIGNIN_URL = `${SSO_ORIGIN}/sso/signin`;
const GC_MODERN = 'https://connect.garmin.com/modern';
const OAUTH_URL = 'https://connectapi.garmin.com/oauth-service/oauth';

interface MfaSession {
  cookies: string[];
  csrf: string;
  signinParams: string;
}

// In-memory store for MFA sessions (short-lived)
const mfaSessions = new Map<string, { session: MfaSession; expires: number }>();

function extractCookies(response: any): string[] {
  const setCookies = response.headers?.['set-cookie'] || [];
  return Array.isArray(setCookies) ? setCookies : [setCookies];
}

function cookieHeader(allCookies: string[]): string {
  return allCookies
    .map(c => c.split(';')[0])
    .join('; ');
}

export async function garminLogin(email: string, password: string): Promise<
  | { success: true; tokens: { oauth1: any; oauth2: any } }
  | { mfaRequired: true; sessionId: string }
  | { error: string }
> {
  try {
    const client = axios.create({
      maxRedirects: 0,
      validateStatus: (s) => s < 500,
    });

    let allCookies: string[] = [];

    // Step 1: Get SSO page + cookies
    const step1Params = { clientId: 'GarminConnect', locale: 'en', service: GC_MODERN };
    const step1Url = `${SSO_EMBED}?${qs.stringify(step1Params)}`;
    const step1 = await client.get(step1Url);
    allCookies.push(...extractCookies(step1));

    // Step 2: Get signin page + CSRF
    const step2Params = { id: 'gauth-widget', embedWidget: true, locale: 'en', gauthHost: SSO_EMBED };
    const step2Url = `${SIGNIN_URL}?${qs.stringify(step2Params)}`;
    const step2 = await client.get(step2Url, {
      headers: { Cookie: cookieHeader(allCookies), 'User-Agent': USER_AGENT },
    });
    allCookies.push(...extractCookies(step2));

    const csrfMatch = CSRF_RE.exec(step2.data);
    if (!csrfMatch) throw new Error('CSRF token not found');
    const csrf = csrfMatch[1];

    // Step 3: Submit credentials
    const signinParams = {
      id: 'gauth-widget',
      embedWidget: true,
      clientId: 'GarminConnect',
      locale: 'en',
      gauthHost: SSO_EMBED,
      service: SSO_EMBED,
      source: SSO_EMBED,
      redirectAfterAccountLoginUrl: SSO_EMBED,
      redirectAfterAccountCreationUrl: SSO_EMBED,
    };
    const step3Url = `${SIGNIN_URL}?${qs.stringify(signinParams)}`;

    const formData = qs.stringify({
      username: email,
      password: password,
      embed: 'true',
      _csrf: csrf,
    });

    const step3 = await client.post(step3Url, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader(allCookies),
        Dnt: '1',
        Origin: SSO_ORIGIN,
        Referer: SIGNIN_URL,
        'User-Agent': USER_AGENT,
      },
    });
    allCookies.push(...extractCookies(step3));

    let html = step3.data || '';
    const location = step3.headers?.location || '';

    // Check for MFA via redirect to verifyMFA page
    const hasMfaRedirect = location.includes('verifyMFA') || location.includes('enterMfaCode');

    if (hasMfaRedirect) {
      // Follow the redirect to get MFA page with CSRF
      const step3Cookies = [...allCookies, ...extractCookies(step3)];
      const mfaPageRes = await client.get(location, {
        headers: { Cookie: cookieHeader(step3Cookies), 'User-Agent': USER_AGENT },
      });
      const mfaHtml = mfaPageRes.data || '';
      const mfaCsrf = CSRF_RE.exec(mfaHtml);
      const sessionId = crypto.randomBytes(16).toString('hex');

      mfaSessions.set(sessionId, {
        session: {
          cookies: [...step3Cookies, ...extractCookies(mfaPageRes)],
          csrf: mfaCsrf ? mfaCsrf[1] : csrf,
          signinParams: qs.stringify(signinParams),
        },
        expires: Date.now() + 5 * 60 * 1000,
      });

      return { mfaRequired: true, sessionId };
    }

    // Follow non-MFA redirect if needed
    if (step3.status === 302 && location) {
      allCookies.push(...extractCookies(step3));
      const followRes = await client.get(location, {
        headers: { Cookie: cookieHeader(allCookies), 'User-Agent': USER_AGENT },
      });
      allCookies.push(...extractCookies(followRes));
      html = followRes.data || '';
    }

    // Check for account locked
    if (html.includes('locked') || html.includes('too many')) {
      return { error: 'Account temporarily locked. Wait a few minutes and try again.' };
    }

    // Check for MFA in HTML body (fallback)
    const hasMfa = MFA_RE.test(html) ||
      html.includes('verifyMFA') ||
      html.includes('mfa-challenge') ||
      html.includes('verification-code') ||
      html.includes('enterMfaCode');

    if (hasMfa) {
      const mfaCsrf = CSRF_RE.exec(html);
      const sessionId = crypto.randomBytes(16).toString('hex');

      mfaSessions.set(sessionId, {
        session: {
          cookies: allCookies,
          csrf: mfaCsrf ? mfaCsrf[1] : csrf,
          signinParams: qs.stringify(signinParams),
        },
        expires: Date.now() + 5 * 60 * 1000,
      });

      return { mfaRequired: true, sessionId };
    }

    // No MFA — extract ticket directly
    const ticketMatch = TICKET_RE.exec(html);
    if (!ticketMatch) {
      if (html.includes('incorrect') || html.includes('Invalid')) {
        return { error: 'Wrong email or password.' };
      }
      console.error('Garmin login - no ticket found. Status:', step3.status);
      return { error: 'Login failed. Please check your credentials.' };
    }

    const ticket = ticketMatch[1];
    const tokens = await exchangeTicketForTokens(ticket);
    return { success: true, tokens };
  } catch (err: any) {
    return { error: err.message || 'Authentication failed' };
  }
}

export async function garminVerifyMfa(sessionId: string, code: string): Promise<
  | { success: true; tokens: { oauth1: any; oauth2: any } }
  | { error: string }
> {
  try {
    const stored = mfaSessions.get(sessionId);
    if (!stored || Date.now() > stored.expires) {
      mfaSessions.delete(sessionId);
      return { error: 'MFA session expired. Please start login again.' };
    }

    const { cookies, csrf, signinParams } = stored.session;
    mfaSessions.delete(sessionId);

    const client = axios.create({
      maxRedirects: 0,
      validateStatus: (s) => s < 500,
    });

    // Submit MFA verification code
    const verifyUrl = `${SSO_ORIGIN}/sso/verifyMFA/loginEnterMfaCode?${signinParams}`;
    const formData = qs.stringify({
      'verification-code': code,
      verificationCode: code,
      _csrf: csrf,
      embed: 'true',
    });

    let res = await client.post(verifyUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader(cookies),
        Origin: SSO_ORIGIN,
        Referer: `${SSO_ORIGIN}/sso/verifyMFA/loginEnterMfaCode`,
        'User-Agent': USER_AGENT,
      },
    });

    let allCookies = [...cookies, ...extractCookies(res)];
    let html = res.data || '';

    // Follow redirects (up to 5) looking for the ticket
    let attempts = 0;
    while (res.status === 302 && attempts < 5) {
      const location = res.headers?.location || '';

      // Check if ticket is in the redirect URL itself
      const ticketInUrl = TICKET_RE.exec(location);
      if (ticketInUrl) {
        const tokens = await exchangeTicketForTokens(ticketInUrl[1]);
        return { success: true, tokens };
      }

      const fullUrl = location.startsWith('http') ? location : `${SSO_ORIGIN}${location}`;
      res = await client.get(fullUrl, {
        headers: { Cookie: cookieHeader(allCookies), 'User-Agent': USER_AGENT },
      }) as any;
      allCookies.push(...extractCookies(res));
      html = res.data || '';
      attempts++;
    }

    const ticketMatch = TICKET_RE.exec(html);
    if (!ticketMatch) {
      console.error('MFA verify - no ticket. Status:', res.status, 'HTML:', (html || '').substring(0, 500));
      if (html.includes('incorrect') || html.includes('Invalid') || html.includes('invalid')) {
        return { error: 'Invalid verification code. Please try again.' };
      }
      return { error: 'MFA verification failed. Please start login again.' };
    }

    const ticket = ticketMatch[1];
    const tokens = await exchangeTicketForTokens(ticket);
    return { success: true, tokens };
  } catch (err: any) {
    return { error: err.message || 'MFA verification failed' };
  }
}

async function exchangeTicketForTokens(ticket: string): Promise<{ oauth1: any; oauth2: any }> {
  // Fetch OAuth consumer credentials
  const consumerRes = await axios.get(OAUTH_CONSUMER_URL);
  const consumer = consumerRes.data;

  // Get OAuth1 token
  const OAuth = require('oauth-1.0a');
  const oauth = new OAuth({
    consumer: { key: consumer.consumer_key, secret: consumer.consumer_secret },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString: string, key: string) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });

  const preAuthParams = {
    ticket,
    'login-url': SSO_EMBED,
    'accepts-mfa-tokens': true,
  };
  const preAuthUrl = `${OAUTH_URL}/preauthorized?${qs.stringify(preAuthParams)}`;
  const requestData = { url: preAuthUrl, method: 'GET' };
  const oauthHeaders = oauth.toHeader(oauth.authorize(requestData));

  const oauth1Res = await axios.get(preAuthUrl, {
    headers: { ...oauthHeaders, 'User-Agent': 'com.garmin.android.apps.connectmobile' },
  });
  const oauth1 = qs.parse(oauth1Res.data);

  // Exchange for OAuth2
  const exchangeUrl = `${OAUTH_URL}/exchange/user/2.0`;
  const exchangeOauth = new OAuth({
    consumer: { key: consumer.consumer_key, secret: consumer.consumer_secret },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString: string, key: string) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });

  const exchangeRequestData = { url: exchangeUrl, method: 'POST' };
  const token = { key: oauth1.oauth_token as string, secret: oauth1.oauth_token_secret as string };
  const exchangeHeaders = exchangeOauth.toHeader(exchangeOauth.authorize(exchangeRequestData, token));

  const oauth2Res = await axios.post(exchangeUrl, null, {
    headers: { ...exchangeHeaders, 'User-Agent': 'com.garmin.android.apps.connectmobile', 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return { oauth1, oauth2: oauth2Res.data };
}

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of mfaSessions.entries()) {
    if (now > data.expires) mfaSessions.delete(id);
  }
}, 60000);

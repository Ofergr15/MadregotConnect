import { GarminConnect } from 'garmin-connect';

async function fetchGarminData() {
  const gc = new GarminConnect({
    username: 'grosfeldofer@gmail.com',
    password: 'Datech15',
  });

  console.log('Logging in...');
  await gc.login();
  console.log('Logged in successfully\n');

  // Fetch user profile
  try {
    const profile = await gc.getUserSettings();
    console.log('=== USER PROFILE ===');
    console.log(JSON.stringify(profile, null, 2).slice(0, 500));
    console.log('\n');
  } catch (e: any) {
    console.log('Profile error:', e.message);
  }

  // Fetch workouts (training plans on the calendar)
  try {
    const workouts = await gc.getWorkouts(0, 10);
    console.log('=== WORKOUTS ===');
    console.log(`Found ${(workouts as any[]).length} workouts`);
    if ((workouts as any[]).length > 0) {
      // Show first 3 workouts in detail
      for (const w of (workouts as any[]).slice(0, 5)) {
        console.log('\n--- Workout ---');
        console.log(JSON.stringify(w, null, 2));
      }
    }
    console.log('\n');
  } catch (e: any) {
    console.log('Workouts error:', e.message);
  }

  // Fetch recent activities
  try {
    const activities = await gc.getActivities(0, 5);
    console.log('=== RECENT ACTIVITIES ===');
    console.log(`Found ${(activities as any[]).length} activities`);
    for (const a of (activities as any[]).slice(0, 3)) {
      console.log(`\n- ${a.activityName} | ${a.activityType?.typeKey} | ${a.startTimeLocal} | Distance: ${(a.distance / 1000).toFixed(2)}km | Duration: ${Math.round(a.duration / 60)}min`);
    }
    console.log('\n');
  } catch (e: any) {
    console.log('Activities error:', e.message);
  }

  // Fetch training plan / calendar events
  try {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 14);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 14);

    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];

    const tokens = gc.exportToken() as any;
    const accessToken = tokens.oauth2?.access_token;

    // Fetch calendar items (workouts scheduled)
    const calRes = await fetch(
      `https://connectapi.garmin.com/workout-service/workouts?start=0&limit=20`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'NK': 'NT',
          'DI-Backend': 'connectapi.garmin.com',
        },
      }
    );

    if (calRes.ok) {
      const calData = await calRes.json();
      console.log('=== SCHEDULED WORKOUTS (API) ===');
      console.log(JSON.stringify(calData, null, 2).slice(0, 3000));
    } else {
      console.log('Calendar API error:', calRes.status, await calRes.text().catch(() => ''));
    }
    console.log('\n');
  } catch (e: any) {
    console.log('Calendar error:', e.message);
  }

  // Try to get training plans
  try {
    const tokens = gc.exportToken() as any;
    const accessToken = tokens.oauth2?.access_token;

    const planRes = await fetch(
      `https://connectapi.garmin.com/trainingplan-service/trainingplan/search?start=0&limit=20`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'NK': 'NT',
          'DI-Backend': 'connectapi.garmin.com',
        },
      }
    );

    if (planRes.ok) {
      const planData = await planRes.json();
      console.log('=== TRAINING PLANS ===');
      console.log(JSON.stringify(planData, null, 2).slice(0, 2000));
    } else {
      console.log('Training plans API:', planRes.status);
    }
    console.log('\n');
  } catch (e: any) {
    console.log('Training plans error:', e.message);
  }

  // Try clipboard / team endpoint
  try {
    const tokens = gc.exportToken() as any;
    const accessToken = tokens.oauth2?.access_token;

    const teamRes = await fetch(
      `https://connectapi.garmin.com/team-service/team`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'NK': 'NT',
          'DI-Backend': 'connectapi.garmin.com',
        },
      }
    );

    if (teamRes.ok) {
      const teamData = await teamRes.json();
      console.log('=== TEAMS / CLIPBOARD ===');
      console.log(JSON.stringify(teamData, null, 2).slice(0, 2000));
    } else {
      console.log('Teams API:', teamRes.status, await teamRes.text().catch(() => ''));
    }
  } catch (e: any) {
    console.log('Teams error:', e.message);
  }
}

fetchGarminData().catch(console.error);

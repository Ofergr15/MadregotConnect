'use client';

import { useRouter } from 'next/navigation';
import {
  Activity,
  Upload,
  Cpu,
  Send,
  FileText,
  Image as ImageIcon,
  Users,
  UserCircle,
  Calendar,
  TrendingUp,
  Clock,
  CheckCircle2,
  Zap,
  History
} from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-8 w-8 text-primary-500" />
            <span className="text-xl font-bold text-white">MadregotConnect</span>
          </div>
          <button
            onClick={() => router.push('/login')}
            className="text-slate-400 hover:text-white transition-colors text-sm"
          >
            Sign In
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-slate-900 pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32 text-center">
          <div className="inline-flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-full px-4 py-2 mb-8">
            <Zap className="h-4 w-4 text-primary-400" />
            <span className="text-sm text-slate-300">AI-Powered Workout Delivery</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6">
            AI-Powered Workout Delivery <br className="hidden sm:block" />
            for <span className="bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">Garmin</span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto mb-10">
            Transform text and images into structured Garmin workouts with Claude AI.
            Push training plans to all your athletes with one click.
          </p>

          <button
            onClick={() => router.push('/dashboard')}
            className="btn-primary text-lg px-8 py-4 inline-flex items-center gap-2 shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 transition-all"
          >
            Get Started
            <Send className="h-5 w-5" />
          </button>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-3xl mx-auto">
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <div className="text-3xl font-bold text-white mb-1">2,500+</div>
              <div className="text-slate-400 text-sm">Workouts Delivered</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <div className="text-3xl font-bold text-white mb-1">150+</div>
              <div className="text-slate-400 text-sm">Athletes Connected</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <div className="text-3xl font-bold text-white mb-1">5 hrs</div>
              <div className="text-slate-400 text-sm">Saved Per Week</div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 sm:py-32 bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              How It Works
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              From training plan to athlete&apos;s watch in three simple steps
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
            {/* Step 1 */}
            <div className="relative">
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 text-center">
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/20">
                  <Upload className="h-8 w-8 text-white" />
                </div>
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">
                  1
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Paste or Upload</h3>
                <p className="text-slate-400">
                  Coach pastes text or uploads an image of the training plan. Supports any format.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative">
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 text-center">
                <div className="bg-gradient-to-br from-purple-500 to-purple-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-500/20">
                  <Cpu className="h-8 w-8 text-white" />
                </div>
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">
                  2
                </div>
                <h3 className="text-xl font-bold text-white mb-3">AI Parses</h3>
                <p className="text-slate-400">
                  Claude AI converts it into structured Garmin workouts with intervals and targets.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative">
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 text-center">
                <div className="bg-gradient-to-br from-green-500 to-green-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/20">
                  <Send className="h-8 w-8 text-white" />
                </div>
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">
                  3
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Push to Athletes</h3>
                <p className="text-slate-400">
                  One click pushes the workout to all athletes&apos; Garmin watches simultaneously.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 sm:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Powerful Features
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Everything you need to manage and deliver workouts at scale
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="card hover:border-primary-500/50 transition-colors group">
              <div className="bg-primary-600/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-600/20 transition-colors">
                <FileText className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">AI Text Parsing</h3>
              <p className="text-slate-400 text-sm">
                Paste any text format - Claude AI understands intervals, paces, and workout structures.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="card hover:border-primary-500/50 transition-colors group">
              <div className="bg-primary-600/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-600/20 transition-colors">
                <ImageIcon className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Image Recognition</h3>
              <p className="text-slate-400 text-sm">
                Upload screenshots or photos of training plans - AI extracts the workout details.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="card hover:border-primary-500/50 transition-colors group">
              <div className="bg-primary-600/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-600/20 transition-colors">
                <Users className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Multi-Athlete Push</h3>
              <p className="text-slate-400 text-sm">
                Send the same workout to your entire team or group with a single click.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="card hover:border-primary-500/50 transition-colors group">
              <div className="bg-primary-600/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-600/20 transition-colors">
                <UserCircle className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Group Pace Profiles</h3>
              <p className="text-slate-400 text-sm">
                Define pace zones for different groups - workouts auto-scale to each athlete.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="card hover:border-primary-500/50 transition-colors group">
              <div className="bg-primary-600/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-600/20 transition-colors">
                <Calendar className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Calendar Scheduling</h3>
              <p className="text-slate-400 text-sm">
                Workouts appear directly in the Garmin training calendar on the scheduled date.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="card hover:border-primary-500/50 transition-colors group">
              <div className="bg-primary-600/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-600/20 transition-colors">
                <CheckCircle2 className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Delivery Tracking</h3>
              <p className="text-slate-400 text-sm">
                See who received their workout and track delivery status in real-time.
              </p>
            </div>

            {/* Feature 7 */}
            <div className="card hover:border-primary-500/50 transition-colors group">
              <div className="bg-primary-600/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-600/20 transition-colors">
                <History className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Weekly Plan History</h3>
              <p className="text-slate-400 text-sm">
                Access past workouts and training plans. Reuse or modify for future weeks.
              </p>
            </div>

            {/* Feature 8 */}
            <div className="card hover:border-primary-500/50 transition-colors group">
              <div className="bg-primary-600/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-600/20 transition-colors">
                <TrendingUp className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Performance Insights</h3>
              <p className="text-slate-400 text-sm">
                Track workout completion rates and athlete engagement over time.
              </p>
            </div>

            {/* Feature 9 */}
            <div className="card hover:border-primary-500/50 transition-colors group">
              <div className="bg-primary-600/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-600/20 transition-colors">
                <Clock className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Time Saver</h3>
              <p className="text-slate-400 text-sm">
                No more manual workout creation or individual uploads. Save hours every week.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 sm:py-32 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Ready to Transform Your Coaching?
          </h2>
          <p className="text-lg text-slate-400 mb-10">
            Join coaches who are saving time and delivering better training experiences
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="btn-primary text-lg px-8 py-4 inline-flex items-center gap-2 shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 transition-all"
          >
            Get Started Now
            <Send className="h-5 w-5" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary-500" />
              <span className="text-lg font-bold text-white">MadregotConnect</span>
            </div>
            <div className="text-slate-400 text-sm">
              © 2026 MadregotConnect. AI-powered workout delivery for Garmin.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

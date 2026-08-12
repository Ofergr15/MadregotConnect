export type ToolMetadata = {
  hidden?: boolean;
  label: string;
  running: string;
  complete: string;
};

const EN: Record<string, ToolMetadata> = {
  get_current_date: { hidden: true, label: 'Current date', running: 'Checking the date', complete: 'Date checked' },
  get_activity_details: { label: 'Run details', running: 'Loading run details', complete: 'Run details loaded' },
  analyze_activity_laps: { label: 'Lap analysis', running: 'Analyzing laps', complete: 'Laps analyzed' },
  get_planned_workout: { label: 'Workout plan', running: 'Loading the workout plan', complete: 'Workout plan loaded' },
  analyze_activity_workout: { label: 'Plan vs execution', running: 'Comparing plan with execution', complete: 'Plan comparison complete' },
  get_activity_gpx: { label: 'Route analysis', running: 'Reading the route', complete: 'Route analyzed' },
  get_recent_runs: { label: 'Recent runs', running: 'Loading recent runs', complete: 'Recent runs loaded' },
  search_run_history: { label: 'Run history', running: 'Searching run history', complete: 'Run history searched' },
  compare_runs: { label: 'Run comparison', running: 'Comparing runs', complete: 'Runs compared' },
  find_similar_workouts: { label: 'Similar runs', running: 'Finding similar runs', complete: 'Similar runs found' },
};

const HE: Record<string, ToolMetadata> = {
  get_current_date: { hidden: true, label: 'תאריך נוכחי', running: 'בודק את התאריך', complete: 'התאריך נבדק' },
  get_activity_details: { label: 'פרטי הריצה', running: 'טוען את פרטי הריצה', complete: 'פרטי הריצה נטענו' },
  analyze_activity_laps: { label: 'ניתוח הקפות', running: 'מנתח את ההקפות', complete: 'ההקפות נותחו' },
  get_planned_workout: { label: 'תוכנית האימון', running: 'טוען את תוכנית האימון', complete: 'תוכנית האימון נטענה' },
  analyze_activity_workout: { label: 'תכנון מול ביצוע', running: 'משווה את התכנון לביצוע', complete: 'ההשוואה הושלמה' },
  get_activity_gpx: { label: 'ניתוח המסלול', running: 'קורא את המסלול', complete: 'המסלול נותח' },
  get_recent_runs: { label: 'ריצות אחרונות', running: 'טוען ריצות אחרונות', complete: 'הריצות האחרונות נטענו' },
  search_run_history: { label: 'היסטוריית ריצות', running: 'מחפש בהיסטוריית הריצות', complete: 'החיפוש הושלם' },
  compare_runs: { label: 'השוואת ריצות', running: 'משווה בין הריצות', complete: 'הריצות הושוו' },
  find_similar_workouts: { label: 'ריצות דומות', running: 'מחפש ריצות דומות', complete: 'נמצאו ריצות דומות' },
};

export function getToolMetadata(name: string, locale: string): ToolMetadata {
  const source = locale === 'he' ? HE : EN;
  return source[name] || {
    label: name.replaceAll('_', ' '),
    running: locale === 'he' ? 'מריץ כלי' : 'Running tool',
    complete: locale === 'he' ? 'הכלי הושלם' : 'Tool complete',
  };
}

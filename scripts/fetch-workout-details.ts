import { GarminConnect } from 'garmin-connect';

async function fetchWorkoutDetails() {
  const gc = new GarminConnect({
    username: 'grosfeldofer@gmail.com',
    password: 'Datech15',
  });

  await gc.login();
  const tokens = gc.exportToken() as any;
  const accessToken = tokens.oauth2?.access_token;

  // Fetch detailed steps for the Clipboard workouts
  const clipboardWorkoutIds = [
    1607133192, // יום שישי
    1607111835, // שבת
    1607108734, // חמישי
    1607106677, // יום שלישי
  ];

  for (const workoutId of clipboardWorkoutIds) {
    const res = await fetch(
      `https://connectapi.garmin.com/workout-service/workout/${workoutId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'NK': 'NT',
          'DI-Backend': 'connectapi.garmin.com',
        },
      }
    );

    if (res.ok) {
      const workout = await res.json();
      console.log(`\n${'='.repeat(60)}`);
      console.log(`WORKOUT: ${workout.workoutName} (ID: ${workoutId})`);
      console.log(`${'='.repeat(60)}`);
      console.log(JSON.stringify(workout, null, 2));
    } else {
      console.log(`Failed to fetch ${workoutId}: ${res.status}`);
    }
  }

  // Also fetch all workouts from Clipboard (looking for more)
  const allWorkouts = await gc.getWorkouts(0, 50) as any[];
  const clipboardWorkouts = allWorkouts.filter(w => w.workoutProvider === 'Garmin Clipboard');

  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`TOTAL CLIPBOARD WORKOUTS: ${clipboardWorkouts.length}`);
  console.log(`${'='.repeat(60)}`);

  for (const w of clipboardWorkouts) {
    console.log(`- ${w.workoutName} | Created: ${w.createdDate} | ID: ${w.workoutId}`);
  }
}

fetchWorkoutDetails().catch(console.error);

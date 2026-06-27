# Groups Page Redesign - Implementation Summary

## Overview
Redesigned the Groups page to use a simple pace offset model instead of complex 6-zone pace profiles, matching the real workflow where coaches write workouts with multi-bracket notation.

## Changes Made

### 1. Groups Page (`/src/app/dashboard/groups/page.tsx`)
**Complete rewrite** - New features:
- **Simplified model**: Each group has a single `paceOffsetSeconds` value (integer)
- **Level indicators**: Visual categorization (fast/medium/slow) with color coding
  - Fast (green): Offset <= 0s
  - Medium (yellow): Offset 1-15s
  - Slow (orange): Offset > 15s
- **Live preview**: Shows example base pace (4:00/km) and resulting group pace
- **Visual design**: Card-based layout with Garmin Connect dark theme
- **Default groups**: Button to create 3 default groups (A=0s, B=+10s, C=+20s)
- **Edit modal**: Inline editing with quick offset buttons (+/-5s, +10s, etc.)
- **Info card**: Explains how multi-bracket notation works

### 2. Groups API Route (`/src/app/api/groups/route.ts`)
**Modified all endpoints**:
- **GET**: Transform `pace_profile` JSONB to extract `offsetSeconds` and `level`
- **POST**: Store `{ offsetSeconds: number, level: string }` in `pace_profile` column
- **PUT**: Update offset and level while preserving JSONB structure
- **Backwards compatible**: Handles both old 6-zone format and new offset format

### 3. Join Groups API (`/src/app/api/join/groups/route.ts`)
**Enhanced response**:
- Now returns `paceOffsetSeconds` and `level` for each group
- Allows join page to display detailed group information

### 4. Join Page (`/src/app/join/[token]/page.tsx`)
**Improved group selection**:
- Groups displayed as interactive cards instead of dropdown
- Shows pace offset and level badge for each group
- Color-coded by level (green/yellow/orange)
- Better visual hierarchy for athlete onboarding

### 5. Script Fixes
**Fixed TypeScript errors** in:
- `/scripts/fetch-garmin-data.ts`: Added required parameters to `getWorkouts(0, 10)`
- `/scripts/fetch-workout-details.ts`: Added required parameters to `getWorkouts(0, 50)`

## Database Schema
**No migration required** - Uses existing `pace_profile` JSONB column:
- **Old format**: `{ easy: {min, max}, threshold: {min, max}, ... }`
- **New format**: `{ offsetSeconds: 10, level: "medium" }`

The API handles both formats for backwards compatibility.

## How It Works

### Multi-Bracket Notation
When a coach writes a workout with multi-bracket paces:
- `3:50` (no brackets) = Group A uses base pace (offset +0s)
- `(4:00)` (single brackets) = Group B adds their offset (e.g., +10s = 4:10/km)
- `((4:10))` (double brackets) = Group C adds their offset (e.g., +20s = 4:30/km)

### Example
If groups are configured as:
- **Group A - Fast**: +0s offset
- **Group B - Medium**: +10s offset
- **Group C - Slow**: +20s offset

When coach writes "Run 5km at 4:00/km":
- Group A runs at 4:00/km
- Group B runs at 4:10/km
- Group C runs at 4:20/km

## UI/UX Features

### Visual Design
- Dark theme (slate-800/900 backgrounds)
- Color-coded levels (green/yellow/orange)
- Icon indicators (Zap/TrendingUp/Activity)
- Card-based layout with hover effects
- Consistent with existing Athletes page design

### User Flow
1. Create groups with meaningful names (e.g., "Group A - Fast")
2. Set pace offset in seconds per kilometer
3. Choose visual level (fast/medium/slow)
4. See live preview of resulting pace
5. Groups automatically sort by offset (fastest first)

### Accessibility
- Large touch targets for mobile
- Clear visual hierarchy
- Descriptive labels
- Keyboard navigation support
- Hover states for all interactive elements

## Testing

### Build Status
- Build: **Successful** ✓
- TypeScript: **No errors** ✓
- Next.js compilation: **Successful** ✓

### API Compatibility
- GET /api/groups: Returns transformed data with `paceOffsetSeconds` and `level`
- POST /api/groups: Accepts `paceOffsetSeconds` and `level`
- PUT /api/groups: Updates offset and level
- DELETE /api/groups: Unchanged

### Backwards Compatibility
- Old groups with 6-zone profiles will default to offset=0, level="medium"
- No data loss
- Gradual migration possible

## Files Modified

1. `/src/app/dashboard/groups/page.tsx` (730 lines) - Complete rewrite
2. `/src/app/api/groups/route.ts` - All CRUD operations updated
3. `/src/app/api/join/groups/route.ts` - Response enhanced
4. `/src/app/join/[token]/page.tsx` - Group selection improved
5. `/scripts/fetch-garmin-data.ts` - Fixed TypeScript error
6. `/scripts/fetch-workout-details.ts` - Fixed TypeScript error

## Next Steps

To use the new groups system:

1. **Create default groups**:
   - Visit /dashboard/groups
   - Click "Create Default Groups (A, B, C)"
   - This creates 3 groups with 0s, +10s, +20s offsets

2. **Assign athletes**:
   - Visit /dashboard/athletes
   - Move athletes to their appropriate groups
   - Athletes will now receive paces adjusted by their group offset

3. **Write workouts**:
   - Use multi-bracket notation: `4:00 (4:10) ((4:20))`
   - The workout parser will apply group offsets automatically

## Implementation Notes

- The `pace_profile` column is still JSONB - just stores simpler data now
- All existing database queries work unchanged
- No Supabase schema migration needed
- Frontend handles data transformation seamlessly
- Live preview helps coaches understand the offset concept

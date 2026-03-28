# Temporal Frame Processing Pipeline Documentation

## Overview

The YogMitra temporal frame processing system has been redesigned to correctly select significant frames for step1, step2, and step3 analysis by detecting the actual yoga activity window and identifying stable, representative frames while avoiding transition artifacts, idle periods, and relaxation frames.

## Problem Statement

Previously, frame selection could include:
- Camera loading and setup frames
- Idle frames before yoga movement starts
- Transition frames between steps (with high movement)
- End-session relaxation frames (when user lowers from pose)
- User walking to stop the session

This resulted in unreliable angle analysis and timing metrics.

## Solution: 8-Step Pipeline

### Step 1: Activity Window Detection

**Goal**: Find when actual yoga movement begins and ends

**Algorithm**:
1. Scan forward through frames looking for 5 consecutive frames with `movement > 0.03`
   - This detects the start of active yoga movement
2. Scan backward from end looking for 10 consecutive frames with `movement < 0.01`
   - This detects when activity ends (long idle period)
3. Return `[activityStartIndex, activityEndIndex]`

**Removes**:
- Camera loading frames (before activity starts)
- Idle frames before yoga (user adjusting position)
- End-session walking frames (after activity ends)

**Parameters**:
```javascript
ACTIVITY_START_MOVEMENT_THRESHOLD = 0.03
ACTIVITY_START_CONSECUTIVE_FRAMES = 5
ACTIVITY_END_IDLE_THRESHOLD = 0.01
ACTIVITY_END_IDLE_FRAMES = 10
```

### Step 2: Trim to Activity Window

Slice the frame history to only include frames within the detected activity window.

**Input**: Full frame history + activity indices
**Output**: Trimmed frame history

### Step 3: Step Label Smoothing

**Goal**: Reduce noisy step predictions using majority voting

**Algorithm**:
1. For each frame, look at frames within sliding window (±2 frames if window=5)
2. Count occurrences of step1, step2, step3 in neighborhood
3. Replace frame's step with majority label (ties broken by preferring current step)

**Why**: Raw model predictions are noisy; majority voting stabilizes labels

**Parameter**:
```javascript
STEP_SMOOTHING_WINDOW_SIZE = 5
```

### Step 4: Step Segmentation

**Goal**: Group consecutive frames by step

**Algorithm**:
1. Scan through smoothed frames
2. When step changes, start new segment
3. Remove segments shorter than minimum length

**Removes**: Very short segments (< 5 frames) as noise/misclassifications

**Parameter**:
```javascript
MIN_STEP_SEGMENT_FRAMES = 5
```

### Step 5: Stable Frame Detection

**Goal**: Within each step's frames, find low-movement "stable" frames

**Algorithm**:
For step1, step2, step3 frames:
1. Filter frames where `movement < 0.02`
2. If ≥ 3 stable frames exist, use stable frames
3. Otherwise, use frames with lowest movement (fallback)

**Why**: Stable frames are held poses without transition artifacts

**Parameters**:
```javascript
STABLE_MOVEMENT_THRESHOLD = 0.02
MIN_STABLE_FRAMES = 3
```

### Step 6: Significant Frame Selection

**Goal**: Pick the single most representative stable frame

**Algorithm**:
For stable frames of each step:
1. Find middle index: `Math.floor(stableFrames.length / 2)`
2. Return frame at middle index

**Why**:
- Middle frame avoids first frame (transition IN to stable)
- Middle frame avoids last frame (transition OUT from stable)
- Provides most stable, centered view of the pose

### Step 7: Average Pose Computation (Optional)

**Goal**: Compute average of stable frames for more robust angle comparison

**Algorithm**:
1. For all valid angles in stable frames:
   - Average each joint angle across frames
2. For confidence:
   - Average keypoint confidence across stable frames
3. Return averaged pose + frame count

**Use Case**: When angle comparison, use averaged angles instead of single-frame angles for more stable metrics

### Step 8: Confidence Adjustment

**Goal**: Account for lower keypoint visibility when user is far from camera

**Algorithm**:
```
effectiveConfidence = modelConfidence × visibilityScore
visibilityScore = keystpointConfidence (if ≥ 0.35, else 0)
```

**Why**: Model confidence alone is unreliable; must weight by keypoint visibility

**Parameter**:
```javascript
KEYPOINT_CONFIDENCE_THRESHOLD = 0.35  // Allows far users
MIN_VISIBLE_KEYPOINTS = 10
```

## Data Structures

### Frame Record
```javascript
{
  timestamp: number,          // Frame timestamp in ms
  step: string,              // 'step1', 'step2', 'step3'
  label: string,             // 'correct', 'moderate', 'incorrect'
  confidence: number,        // Model confidence [0-1]
  keypointConfidence: number, // Average keypoint visibility [0-1]
  movement: number,          // Normalized movement magnitude [0-1]
  stabilityScore: number,    // Computed stability metric [0-1]
  keypoints: array,          // Normalized keypoint features
  angles: array,             // Joint angles in degrees
  angleOrder: array,         // Fixed order: [left_elbow, right_elbow, ...]
}
```

### Pipeline Output
```javascript
{
  step1: Frame | null,          // Selected significant frame for step1
  step2: Frame | null,          // Selected significant frame for step2
  step3: Frame | null,          // Selected significant frame for step3
  averagePose: {
    step1: AveragePose | null,
    step2: AveragePose | null,
    step3: AveragePose | null,
  },
  effectiveConfidence: {
    step1: number,              // Visibility-adjusted confidence
    step2: number,
    step3: number,
  },
  selectionMethods: {
    step1: 'stable_mid' | 'fallback_mid' | 'none',
    step2: 'stable_mid' | 'fallback_mid' | 'none',
    step3: 'stable_mid' | 'fallback_mid' | 'none',
  },
  debugLog: array,              // Detailed metrics from each pipeline stage
}
```

### Debug Log Entry
```javascript
{
  stage: string,                // Pipeline stage name
  // Various stage-specific fields
  // See console output for detailed structure
}
```

## Console Output

When a session ends, the pipeline logs detailed information to browser console:

```
=== YOGMITRA TEMPORAL FRAME PROCESSING PIPELINE ===
Input: 450 frames
Activity Window: frames 15-420 (406 frames)
Trimmed to activity window: 406 frames
Applied step label smoothing with window size 5
Segmented into 3 step segments
  step1: 145 frames
  step2: 134 frames
  step3: 127 frames
step1: 145 frames, 42 stable, 103 fallback
step1: stable_mid (confidence: 67.3%, effective: 45.2%)
step2: 134 frames, 38 stable, 96 fallback
step2: stable_mid (confidence: 72.1%, effective: 51.8%)
step3: 127 frames (trimmed from 127): 35 stable, 92 fallback
step3: stable_mid (confidence: 69.5%, effective: 48.7%)
=== SIGNIFICANT FRAMES SELECTED ===
step1: stable_mid (confidence: 67.3%, effective: 45.2%)
step2: stable_mid (confidence: 72.1%, effective: 51.8%)
step3: stable_mid (confidence: 69.5%, effective: 48.7%)
=== END PIPELINE ===
```

## Integration with Main Code

### Entry Point
In `main.js`, when session ends:
```javascript
const significantFrames = selectSignificantFramesWithTemporalProcessing(trimmedFrameHistory);
```

### Backward Compatibility
- Function returns frames in same format as original `selectSignificantFrames()`
- All downstream code (angle analysis, timing, scoring) works unchanged
- Pipeline debug info available in extended return object

### Using Average Poses
For more robust angle comparison (optional upgrade):
```javascript
// Instead of:
const userAngles = significantFrames.step1.angles;

// Can use:
const userAngles = significantFrames.averagePoses.step1.angles;
const frameCount = significantFrames.averagePoses.step1.frameCount;
```

## Tuning Parameters

### For Different Environments

**User very far from camera**:
- Increase `KEYPOINT_CONFIDENCE_THRESHOLD` → 0.40
- Increase `ACTIVITY_START_MOVEMENT_THRESHOLD` → 0.04

**User moving slowly**:
- Decrease `STABLE_MOVEMENT_THRESHOLD` → 0.015
- Increase `ACTIVITY_START_CONSECUTIVE_FRAMES` → 7

**Noisy step predictions**:
- Increase `STEP_SMOOTHING_WINDOW_SIZE` → 7
- Increase `MIN_STEP_SEGMENT_FRAMES` → 7

## Testing & Validation

### Check Console Logs
After each session, verify console shows:
1. Reasonable activity window (not entire session)
2. Frames trimmed to activity period
3. 3 valid step segments
4. At least 3 stable frames per step
5. Selection method is 'stable_mid' not 'fallback_mid'

### Angle Analysis Quality
- Check if angle errors are now more consistent
- Verify selected frames show user in stable pose position
- Confirm timestamps make sense (progressive through session)

### Timing Analysis Quality
- Verify step timings are reasonable
- Check that step1 timing < step2 timing < step3 timing

## Future Enhancements

1. **Use averaged poses** instead of single frames for angle comparison
2. **Segment-level analysis** instead of just middle frame
3. **Per-frame confidence mapping** for more sophisticated scoring
4. **Multi-asana support** with different thresholds per asana
5. **User-specific calibration** based on historical performance

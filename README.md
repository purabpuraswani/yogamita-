# YogMitra

AI yoga posture evaluation system for Konasana with step-wise analysis, temporal frame processing, timing metrics, angle-error analysis, and report generation.

## Project Description

YogMitra performs real-time pose tracking using MoveNet, evaluates user posture quality step-by-step, and produces a full session report. The system is designed around a temporal pipeline to avoid noisy transition frames and select significant stable frames for reliable analytics.

## Features

- Real-time webcam pose estimation using MoveNet.
- Step-wise pose flow detection: step1 -> step2 -> step3.
- Frame-level classification: correct, moderate, incorrect.
- Exponential Moving Average keypoint smoothing.
- Movement-aware stable frame extraction.
- State-machine enforced step order in post-session analysis.
- Majority smoothing of step labels.
- Step segment denoising and longest-segment selection.
- Timing analysis relative to first detected step1 frame.
- Degree-based angle error analysis with fixed angle order.
- Session scoring from accuracy, angle, timing, and stability components.
- Skeleton visualization snapshots for significant frames.
- Backend report API with OpenRouter and local fallback report generation.

## System Architecture

- Frontend: Vite + React UI with realtime analysis loop.
- Pose Engine: MoveNet keypoint extraction in browser.
- Prediction Engine: TensorFlow.js step-wise models.
- Session Analyzer: frame trimming, segmentation, stability detection, timing/angle scoring.
- Backend API: Express endpoint for final narrative report.
- Data/Models: generated datasets and trained step-specific model artifacts.

## Frame Processing Pipeline

Video Frames
-> MoveNet Keypoints
-> Keypoint Smoothing (EMA)
-> Angle Calculation
-> Movement Calculation
-> Step Classification
-> Frame Storage
-> Frame Trimming
-> Step Segmentation
-> Stable Segment Detection
-> Significant Frame Selection
-> Angle Analysis
-> Timing Analysis
-> Session Scoring
-> Report Generation
-> Skeleton Visualization

## Dataset Generation Pipeline

1. Read step-wise labeled images from dataset folders.
2. Detect keypoints per image with MoveNet.
3. Build keypoint features, joint-angle features, movement, and body-ratio features.
4. Generate one-hot class labels.
5. Save step datasets to `datasets/konasana`.

Run:

```bash
npm run dataset
```

## Model Training Pipeline

1. Load each step dataset from `datasets/konasana`.
2. Validate feature consistency and angle-order metadata.
3. Train separate TensorFlow.js models for step1, step2, and step3.
4. Save artifacts to `models/step1_model`, `models/step2_model`, `models/step3_model`.

Run:

```bash
npm run train
```

## Runtime Evaluation Pipeline

1. Capture webcam frames.
2. Extract keypoints and smooth with EMA.
3. Compute movement and step-aware feature vectors.
4. Predict step and posture label.
5. Record frame-level data with timestamp, movement, confidence, and angles.
6. On session end, process timeline to extract robust significant frames.

## Timing Analysis

- Reference time is anchored to the first step1 frame.
- User timings:
  - userStep1Time = step1Timestamp - sessionStartReference
  - userStep2Time = step2Timestamp - sessionStartReference
  - userStep3Time = step3Timestamp - sessionStartReference
- Delay values are compared against ideal step timings.

## Angle Analysis

Angle order is fixed end-to-end:

0 left_elbow
1 right_elbow
2 left_shoulder
3 right_shoulder
4 left_knee
5 right_knee
6 hip
7 spine

Per-joint angle error:

`angleError = abs(userAngle[i] - idealAngle[i])`

Angles are compared in degrees for consistency.

## Report Generation

- Session metrics are aggregated after significant frame extraction.
- A structured report payload is sent to backend (`POST /api/sedentary/report`).
- OpenRouter generates the final narrative when available.
- Local fallback report is returned when API quota or service errors occur.

## Asana Chatbot (OpenRouter)

- Live Practice page includes an Asana Chatbot panel.
- Chatbot request includes selected asana info, user profile, and latest session summary.
- Frontend sends context to backend `POST /api/sedentary/chat`.
- Backend uses OpenRouter when `OPENROUTER_API_KEY` is configured.
- If key is missing or API is unavailable, a local fallback answer is returned.

## Skeleton Visualization

- Significant frames for step1, step2, and step3 are used to generate skeleton overlays.
- Visuals correspond to stable mid-segment frames to avoid transition artifacts.

## Modular Architecture

YogMitra uses a **router-based modular system** to support multiple independent analysis modules.

### Module System

- **Shared UI Layer** (`src/app/`): Common UI, Router, and PipelineView shared across all modules.
- **Module Router** (`src/app/Router.jsx`): Routes based on `window.__yogmitraActiveModule`.
- **Isolated Modules** (`src/modules/`): Each module is completely self-contained with its own logic, models, and datasets.

### Current Modules

- **Sedentary** (`src/modules/sedentary/`): Fully implemented. Real-time yoga posture analysis for Konasana with temporal processing and scoring.
- **Mental** (`src/modules/mental/`): Placeholder. Reserved for mental health module implementation by external team.

### Module Activation

Set the active module before app boot:

```javascript
window.__yogmitraActiveModule = 'sedentary';  // default
// or
window.__yogmitraActiveModule = 'mental';      // future
```

Router will automatically load the appropriate module. If not set, defaults to sedentary.

### Module Integration for External Teams

To add a new module (e.g., mental health):

1. Create module directory: `src/modules/[module_name]/`
2. Implement module entry file (e.g., `mentalApp.js`):
   ```javascript
   export function start[Module]App() {
     // Initialize your module
   }
   export function stop[Module]App() {
     // Cleanup
   }
   ```
3. Add backend routes with `/api/[module_name]/*` prefix.
4. Update `src/modules/index.js` to export your module.
5. Router will automatically serve your module when `window.__yogmitraActiveModule` matches.

**Critical:** Do NOT modify files outside your module directory. Shared UI is read-only.

## Folder Structure

```text
yogamita-/
  src/
    app/                          # Shared UI layer
      App.jsx                     # Main app entry
      Router.jsx                  # Module router
      LegacyBootstrap.jsx         # Sedentary module loader
      PipelineView.jsx            # Pipeline visualization
      main.jsx                    # React root
    modules/                      # Isolated modules
      sedentary/                  # Sedentary module (fully implemented)
        sedentaryApp.js
      mental/                     # Mental module placeholder (for external team)
        README.md
    assets/
  public/
    ideal_pose_data.json
  server/
    server.js
  scripts/
    generateDataset.js
    train.js
    extractIdealTimings.js
  models/                         # Sedentary module models
    step1_model/
    step2_model/
    step3_model/
  datasets/                       # Sedentary module datasets
    konasana/
  main.js                         # Sedentary core logic
  prediction.js
  report.js
  dashboard.js
  poseDetection.js
  enhancedTemporalPipeline.js
  temporalFrameProcessor.js
  sessionScoringPipeline.js
  package.json
  package-lock.json
  README.md
  .gitignore
```

## Installation Steps

1. Install Node.js (LTS recommended).
2. Clone repository.
3. Install dependencies:

```bash
npm install
```

4. Optional: configure environment variable for OpenRouter.

Create `.env` from `.env.example` and set:

```bash
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4o-mini
```

## Backend Routes

Currently implemented routes:

- `POST /api/sedentary/report` - Generate yoga posture report
- `POST /api/sedentary/chat` - Asana chatbot with OpenRouter integration

New modules should use `/api/[module_name]/*` prefix (e.g., `/api/mental/*`).

## How to Run Project

Development mode:

Terminal 1 (backend)

```powershell
$env:PORT=8000
npm run server
```

Terminal 2 (frontend)

```powershell
npm run dev
```

Open: `http://127.0.0.1:5173`

Note: if port 5173 is occupied, Vite may auto-select the next available port (for example, 5174).

Production-like mode:

```bash
npm run build
npm start
```

Open: `http://127.0.0.1:8000`

## How to Train Models

1. Generate datasets (if needed):

```bash
npm run dataset
```

2. Train step-wise models:

```bash
npm run train
```

3. Extract ideal timings from instructor video (optional):

```bash
npm run extract-ideal-timings
```

## Technologies Used

- JavaScript (ES modules + Node.js)
- React + Vite
- TensorFlow.js
- MoveNet pose detection
- Express.js
- Sharp
- Module Router pattern for multi-module support

## For Integration Partners

### Mental Health Module Team

Your module should:

1. Be completely isolated in `src/modules/mental/`
2. Have its own models in `models/[mental]/` or `src/modules/mental/models/`
3. Have its own datasets in `datasets/mental/` or `src/modules/mental/datasets/`
4. Add backend routes with `/api/mental/*` prefix only
5. Export `startMentalApp()` and `stopMentalApp()` functions
6. NOT modify any files in `src/app/` or core sedentary module
7. NOT share state with sedentary module

The Router will automatically load your module when `window.__yogmitraActiveModule = 'mental'` is set.

See `src/modules/mental/README.md` for detailed integration instructions.

## Future Work

- Multi-asana support with dynamic configuration.
- Better temporal models for step detection (sequence models).
- User-wise calibration and adaptive thresholds.
- Automated dataset quality checks and augmentation controls.
- Richer analytics dashboard and downloadable visualization bundles.
- Mental health module integration.
- Additional wellness modules on the modular platform.

## Author

Purab Puraswani

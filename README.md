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
- A structured report payload is sent to backend (`POST /api/report`).
- OpenRouter generates the final narrative when available.
- Local fallback report is returned when API quota or service errors occur.

## Asana Chatbot (OpenRouter)

- Live Practice page includes an Asana Chatbot panel.
- Chatbot request includes selected asana info, user profile, and latest session summary.
- Frontend sends context to backend `POST /api/chat`.
- Backend uses OpenRouter when `OPENROUTER_API_KEY` is configured.
- If key is missing or API is unavailable, a local fallback answer is returned.

## Skeleton Visualization

- Significant frames for step1, step2, and step3 are used to generate skeleton overlays.
- Visuals correspond to stable mid-segment frames to avoid transition artifacts.

## Folder Structure

```text
yogamita-
  src/
  public/
    ideal_pose_data.json
  scripts/
    generateDataset.js
    train.js
    extractIdealTimings.js
  models/
    step1_model/
    step2_model/
    step3_model/
  datasets/
    konasana/
  main.js
  prediction.js
  report.js
  dashboard.js
  server.js
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

## Future Work

- Multi-asana support with dynamic configuration.
- Better temporal models for step detection (sequence models).
- User-wise calibration and adaptive thresholds.
- Automated dataset quality checks and augmentation controls.
- Richer analytics dashboard and downloadable visualization bundles.

## Author

Purab Puraswani

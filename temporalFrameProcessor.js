/**
 * ==================== YOGMITRA TEMPORAL FRAME PROCESSING PIPELINE ====================
 * 
 * Redesigned frame processing to correctly select significant frames for step1, step2, step3
 * by detecting the actual yoga activity window and avoiding transition/idle/setup frames.
 * 
 * Pipeline Steps:
 * 1. Activity Window Detection - Find yoga movement boundaries
 * 2. Step Label Smoothing - Reduce noise with majority voting
 * 3. Step Segmentation - Group consecutive step frames
 * 4. Stable Frame Detection - Find low-movement frames within each step
 * 5. Significant Frame Selection - Pick middle frame from stable segments
 * 6. Confidence Adjustment - Account for lower keypoint visibility
 * 7. Debug Logging - Track pipeline metrics
 * 
 * ======================================================================================
 */

/**
 * CONSTANTS - Tunable thresholds for activity/stability detection
 */
const ACTIVITY_START_MOVEMENT_THRESHOLD = 0.03;  // Movement above this = active movement
const ACTIVITY_START_CONSECUTIVE_FRAMES = 5;      // Required consecutive active frames to start
const ACTIVITY_END_IDLE_THRESHOLD = 0.01;         // Movement below this = idle
const ACTIVITY_END_IDLE_FRAMES = 10;              // Required consecutive idle frames to end activity

const STABLE_MOVEMENT_THRESHOLD = 0.02;           // Movement threshold for stable frame
const MIN_STABLE_FRAMES = 3;                      // Minimum frames needed for valid stable window

const STEP_SMOOTHING_WINDOW_SIZE = 5;             // Frames for majority voting
const MIN_STEP_SEGMENT_FRAMES = 5;                // Minimum frames to keep step segment

const KEYPOINT_CONFIDENCE_THRESHOLD = 0.35;       // Allow lower visibility for far users
const MIN_VISIBLE_KEYPOINTS = 10;                 // Minimum visible keypoints for valid frame

/**
 * STEP 1: ACTIVITY WINDOW DETECTION
 * 
 * Detects when actual yoga movement starts and ends, ignoring:
 * - Camera loading frames
 * - Idle frames before yoga
 * - User adjusting position
 * - User walking to stop session
 * 
 * Returns: { activityStartIndex, activityEndIndex }
 */
function detectActivityWindow(frameHistory) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		console.log('Activity detection: No frames available');
		return { activityStartIndex: 0, activityEndIndex: frameHistory.length - 1 };
	}

	// Step 1a: Find activity start
	let activityStartIndex = -1;
	for (let i = 0; i <= frameHistory.length - ACTIVITY_START_CONSECUTIVE_FRAMES; i += 1) {
		let consecutiveActive = 0;
		for (let j = i; j < i + ACTIVITY_START_CONSECUTIVE_FRAMES; j += 1) {
			const movement = Number(frameHistory[j]?.movement) || 0;
			if (movement > ACTIVITY_START_MOVEMENT_THRESHOLD) {
				consecutiveActive += 1;
			}
		}
		if (consecutiveActive === ACTIVITY_START_CONSECUTIVE_FRAMES) {
			activityStartIndex = i;
			break;
		}
	}

	if (activityStartIndex === -1) {
		console.log('Activity detection: No activity start detected, using frame 0');
		activityStartIndex = 0;
	}

	// Step 1b: Find activity end (last frame before long idle period)
	let activityEndIndex = frameHistory.length - 1;
	for (let i = frameHistory.length - ACTIVITY_END_IDLE_FRAMES - 1; i >= activityStartIndex; i -= 1) {
		let consecutiveIdle = 0;
		for (let j = i; j < i + ACTIVITY_END_IDLE_FRAMES && j < frameHistory.length; j += 1) {
			const movement = Number(frameHistory[j]?.movement) || 0;
			if (movement < ACTIVITY_END_IDLE_THRESHOLD) {
				consecutiveIdle += 1;
			}
		}
		if (consecutiveIdle === ACTIVITY_END_IDLE_FRAMES) {
			activityEndIndex = i - 1;
			break;
		}
	}

	// Ensure activityEndIndex is valid
	if (activityEndIndex < activityStartIndex) {
		activityEndIndex = frameHistory.length - 1;
	}

	return { activityStartIndex, activityEndIndex };
}

/**
 * STEP 2: TRIM FRAME HISTORY TO ACTIVITY WINDOW
 * 
 * Removes frames outside the detected activity window
 */
function trimToActivityWindow(frameHistory, activityStartIndex, activityEndIndex) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		return [];
	}

	const safeStart = Math.max(0, activityStartIndex);
	const safeEnd = Math.min(frameHistory.length - 1, activityEndIndex);

	if (safeStart > safeEnd) {
		return frameHistory;
	}

	return frameHistory.slice(safeStart, safeEnd + 1);
}

/**
 * STEP 3: STEP LABEL SMOOTHING
 * 
 * Apply majority voting within sliding window to reduce noisy step predictions
 */
function getMajorityStepLabel(stepLabels) {
	if (!Array.isArray(stepLabels) || stepLabels.length === 0) {
		return null;
	}

	const counts = { step1: 0, step2: 0, step3: 0 };
	for (const label of stepLabels) {
		if (counts.hasOwnProperty(label)) {
			counts[label] += 1;
		}
	}

	const max = Math.max(counts.step1, counts.step2, counts.step3);
	if (max === 0) return null;

	if (counts.step1 === max) return 'step1';
	if (counts.step2 === max) return 'step2';
	return 'step3';
}

function smoothStepLabels(frameHistory, windowSize = STEP_SMOOTHING_WINDOW_SIZE) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		return [];
	}

	const radius = Math.floor(windowSize / 2);
	return frameHistory.map((frame, index) => {
		const start = Math.max(0, index - radius);
		const end = Math.min(frameHistory.length - 1, index + radius);
		
		const neighborhood = [];
		for (let i = start; i <= end; i += 1) {
			const step = frameHistory[i]?.step;
			if (step === 'step1' || step === 'step2' || step === 'step3') {
				neighborhood.push(step);
			}
		}

		const smoothedStep = getMajorityStepLabel(neighborhood) || frame.step;
		return { ...frame, step: smoothedStep };
	});
}

/**
 * STEP 4: STEP SEGMENTATION
 * 
 * Group consecutive frames by step, remove very short segments as noise
 */
function segmentByStep(frameHistory) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		return [];
	}

	const segments = [];
	let currentStep = null;
	let currentSegment = [];

	for (const frame of frameHistory) {
		const step = frame?.step;
		
		if (step !== currentStep) {
			if (currentSegment.length >= MIN_STEP_SEGMENT_FRAMES) {
				segments.push({ step: currentStep, frames: currentSegment });
			}
			currentStep = step;
			currentSegment = [frame];
		} else {
			currentSegment.push(frame);
		}
	}

	if (currentSegment.length >= MIN_STEP_SEGMENT_FRAMES) {
		segments.push({ step: currentStep, frames: currentSegment });
	}

	return segments;
}

/**
 * STEP 5: STABLE FRAME DETECTION
 * 
 * Within each step segment, find frames with low movement (< 0.02)
 * If no stable frames exist, use frames with lowest movement
 * 
 * Returns stable frame indices and fallback frames
 */
function findStableFrames(stepFrames) {
	if (!Array.isArray(stepFrames) || stepFrames.length === 0) {
		return { stableFrames: [], fallbackFrames: [] };
	}

	const stableFrames = stepFrames.filter(
		(frame) => (Number(frame?.movement) || 0) < STABLE_MOVEMENT_THRESHOLD
	);

	if (stableFrames.length >= MIN_STABLE_FRAMES) {
		return { stableFrames, fallbackFrames: [] };
	}

	// Fallback: sort by movement (ascending) and take lowest
	const sortedByMovement = [...stepFrames].sort(
		(a, b) => (Number(a?.movement) || 0) - (Number(b?.movement) || 0)
	);

	return {
		stableFrames: stableFrames.length > 0 ? stableFrames : sortedByMovement.slice(0, MIN_STABLE_FRAMES),
		fallbackFrames: sortedByMovement,
	};
}

/**
 * STEP 6: SIGNIFICANT FRAME SELECTION
 * 
 * From stable frames of each step, select the middle frame
 * This avoids transition frames and final relax frames
 */
function selectSignificantFrame(stableFrames, fallbackFrames) {
	if (!Array.isArray(stableFrames) || stableFrames.length === 0) {
		if (Array.isArray(fallbackFrames) && fallbackFrames.length > 0) {
			const midIndex = Math.floor(fallbackFrames.length / 2);
			return { frame: fallbackFrames[midIndex], used: 'fallback_mid' };
		}
		return { frame: null, used: 'none' };
	}

	const midIndex = Math.floor(stableFrames.length / 2);
	return { frame: stableFrames[midIndex], used: 'stable_mid' };
}

/**
 * STEP 7: AVERAGE POSE COMPUTATION (OPTIONAL)
 * 
 * Instead of single frame, compute average keypoints and angles from stable frames
 * Returns average angles for more robust angle comparison
 */
function computeAveragePoseFromStableFrames(stableFrames) {
	if (!Array.isArray(stableFrames) || stableFrames.length === 0) {
		return null;
	}

	const frameCount = stableFrames.length;
	
	// Average angles across stable frames
	const angleArrays = stableFrames
		.map((f) => f?.angles)
		.filter((a) => Array.isArray(a) && a.length > 0);

	if (angleArrays.length === 0) {
		return null;
	}

	const angleLength = angleArrays[0].length;
	const averagedAngles = [];

	for (let i = 0; i < angleLength; i += 1) {
		let sum = 0;
		let count = 0;
		for (const angleArray of angleArrays) {
			const value = Number(angleArray[i]);
			if (Number.isFinite(value)) {
				sum += value;
				count += 1;
			}
		}
		averagedAngles.push(count > 0 ? sum / count : 0);
	}

	// Average keypoint confidence
	const confidences = stableFrames
		.map((f) => Number(f?.keypointConfidence) || 0)
		.filter((c) => c > 0);
	const avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b) / confidences.length : 0;

	return {
		angles: averagedAngles,
		averageConfidence: avgConfidence,
		frameCount,
	};
}

/**
 * STEP 8: CONFIDENCE ADJUSTMENT
 * 
 * Modify confidence scoring to account for lower keypoint visibility
 * when user is far from camera
 */
function computeEffectiveConfidence(modelConfidence, keypointConfidence) {
	const mc = Math.min(1, Math.max(0, Number(modelConfidence) || 0));
	const kc = Math.min(1, Math.max(0, Number(keypointConfidence) || 0));
	
	// effectiveConfidence = modelConfidence * visibilityScore
	// visibilityScore = keypoint confidence, with lower threshold for far users
	const visibilityScore = kc >= KEYPOINT_CONFIDENCE_THRESHOLD ? kc : 0;
	return mc * visibilityScore;
}

/**
 * STEP 9: MAIN PIPELINE ORCHESTRATION
 * 
 * Coordinates all processing steps and returns significant frames with debug logs
 */
function processTemporalFramePipeline(frameHistory) {
	console.log('=== YOGMITRA TEMPORAL FRAME PROCESSING PIPELINE ===');
	console.log(`Input: ${frameHistory.length} frames`);

	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		console.log('No frames to process');
		return {
			step1: null,
			step2: null,
			step3: null,
			debugLog: [],
		};
	}

	const debugLog = [];

	// Step 1: Activity Window Detection
	const { activityStartIndex, activityEndIndex } = detectActivityWindow(frameHistory);
	debugLog.push({
		stage: 'Activity Window Detection',
		activityStartFrame: activityStartIndex,
		activityEndFrame: activityEndIndex,
		duration: activityEndIndex - activityStartIndex + 1,
	});
	console.log(`Activity Window: frames ${activityStartIndex}-${activityEndIndex} (${activityEndIndex - activityStartIndex + 1} frames)`);

	// Step 2: Trim to Activity Window
	const trimmedFrames = trimToActivityWindow(frameHistory, activityStartIndex, activityEndIndex);
	debugLog.push({
		stage: 'Activity Trim',
		beforeCount: frameHistory.length,
		afterCount: trimmedFrames.length,
	});
	console.log(`Trimmed to activity window: ${trimmedFrames.length} frames`);

	// Step 3: Step Label Smoothing
	const smoothedFrames = smoothStepLabels(trimmedFrames, STEP_SMOOTHING_WINDOW_SIZE);
	debugLog.push({
		stage: 'Step Label Smoothing',
		windowSize: STEP_SMOOTHING_WINDOW_SIZE,
		processedFrames: smoothedFrames.length,
	});
	console.log(`Applied step label smoothing with window size ${STEP_SMOOTHING_WINDOW_SIZE}`);

	// Step 4: Step Segmentation
	const segments = segmentByStep(smoothedFrames);
	debugLog.push({
		stage: 'Step Segmentation',
		totalSegments: segments.length,
		segments: segments.map((s) => ({ step: s.step, frameCount: s.frames.length })),
	});
	console.log(`Segmented into ${segments.length} step segments`);
	for (const seg of segments) {
		console.log(`  ${seg.step}: ${seg.frames.length} frames`);
	}

	// Step 5-6: For each step, find stable frames and select significant frame
	const results = {};
	const stepSequence = ['step1', 'step2', 'step3'];

	for (const stepKey of stepSequence) {
		const segment = segments.find((s) => s.step === stepKey);
		
		if (!segment || !segment.frames.length) {
			console.log(`${stepKey}: No frames available`);
			results[stepKey] = null;
			debugLog.push({
				stage: `${stepKey} Processing`,
				status: 'No frames',
				stableFrameCount: 0,
				selectedFrame: null,
			});
			continue;
		}

		const stepFrames = segment.frames;
		const { stableFrames, fallbackFrames } = findStableFrames(stepFrames);
		
		console.log(`${stepKey}: ${stepFrames.length} frames, ${stableFrames.length} stable, ${fallbackFrames.length} fallback`);

		// Step 7: Optional - Compute average pose from stable frames
		const averagePose = stableFrames.length >= MIN_STABLE_FRAMES
			? computeAveragePoseFromStableFrames(stableFrames)
			: null;

		// Step 6: Select significant frame
		const { frame: selectedFrame, used } = selectSignificantFrame(stableFrames, fallbackFrames);

		if (selectedFrame) {
			// Step 8: Compute effective confidence
			const effectiveConf = computeEffectiveConfidence(
				selectedFrame.confidence,
				selectedFrame.keypointConfidence
			);

			results[stepKey] = {
				frame: selectedFrame,
				stableFrameCount: stableFrames.length,
				selectionMethod: used,
				effectiveConfidence: effectiveConf,
				averagePose: averagePose,
			};

			debugLog.push({
				stage: `${stepKey} Processing`,
				status: 'Selected',
				stableFrameCount: stableFrames.length,
				selectedFrame: {
					timestamp: selectedFrame.timestamp,
					confidence: selectedFrame.confidence,
					effectiveConfidence: effectiveConf,
					movement: selectedFrame.movement,
					label: selectedFrame.label,
				},
				selectionMethod: used,
				averagePoseAvailable: averagePose !== null,
			});
		} else {
			results[stepKey] = null;
			debugLog.push({
				stage: `${stepKey} Processing`,
				status: 'Failed - no valid frame',
				stableFrameCount: stableFrames.length,
			});
		}
	}

	// Summary
	console.log('=== SIGNIFICANT FRAMES SELECTED ===');
	for (const step of stepSequence) {
		if (results[step]) {
			const r = results[step];
			console.log(`${step}: ${r.selectionMethod} (confidence: ${(r.frame.confidence * 100).toFixed(1)}%, effective: ${(r.effectiveConfidence * 100).toFixed(1)}%)`);
		} else {
			console.log(`${step}: No frame selected`);
		}
	}
	console.log('=== END PIPELINE ===');

	return {
		step1: results.step1?.frame || null,
		step2: results.step2?.frame || null,
		step3: results.step3?.frame || null,
		averagePose: {
			step1: results.step1?.averagePose || null,
			step2: results.step2?.averagePose || null,
			step3: results.step3?.averagePose || null,
		},
		effectiveConfidence: {
			step1: results.step1?.effectiveConfidence || 0,
			step2: results.step2?.effectiveConfidence || 0,
			step3: results.step3?.effectiveConfidence || 0,
		},
		selectionMethods: {
			step1: results.step1?.selectionMethod || 'none',
			step2: results.step2?.selectionMethod || 'none',
			step3: results.step3?.selectionMethod || 'none',
		},
		debugLog,
	};
}

/**
 * Export for use in main.js
 */
export { processTemporalFramePipeline, detectActivityWindow };

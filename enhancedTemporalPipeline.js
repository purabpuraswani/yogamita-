/**
 * ==================== YOGMITRA COMPREHENSIVE TEMPORAL ANALYSIS REFACTOR ====================
 * 
 * COMPLETE REDESIGN OF FRAME PROCESSING AND ANALYSIS PIPELINE
 * 
 * Addresses all identified issues:
 * 1. Frame consistency across all analyses
 * 2. Guaranteed 3-step skeleton with multi-tier fallbacks
 * 3. Timing analysis using selected frame timestamps
 * 4. Activity detection robust for short sessions
 * 5. Angle validation before classification
 * 6. Robust fallback mechanisms
 * 
 * Pipeline Flow:
 * 1. STAGE 1: Activity Detection → Find yoga movement window
 * 2. STAGE 2: State Machine Filtering → Enforce STEP1 → STEP2 → STEP3 sequence
 * 3. STAGE 3: Segment Extraction → Extract step1, step2, step3 segments
 * 4. STAGE 4: Significant Frame Selection → Select best frame per step (4-tier fallback)
 * 5. STAGE 5: Frame Consistency → Ensure same frames used everywhere
 * 6. STAGE 6: Timing Analysis → Use selected frame timestamps
 * 7. STAGE 7: Angle Validation & Analysis → Validate angles exist before analysis
 * 8. STAGE 8: Scoring → Score from major segments (not all frames)
 * 9. STAGE 9: Report Generation → Ensure consistency
 * 
 * ======================================================================================
 */

/**
 * CONFIGURATION & CONSTANTS
 */

// Activity Detection
const ACTIVITY_DETECTION_CONFIG = {
	START_MOVEMENT_THRESHOLD: 0.03,        // Movement above this indicates activity start
	START_CONSECUTIVE_FRAMES: 5,           // Requires 5 consecutive high-movement frames
	END_IDLE_THRESHOLD: 0.01,              // Movement below this indicates idle
	END_IDLE_FRAMES: 10,                   // Requires 10 consecutive idle frames to end
	MIN_ACTIVITY_DURATION: 8,              // Minimum frames for valid activity (for 15-30 sec sessions)
};

// Step Segmentation & Stability
const SEGMENT_CONFIG = {
	STEP_LABEL_SMOOTHING_WINDOW: 5,        // Majority voting window for step smoothing
	MIN_SEGMENT_LENGTH: 3,                 // Minimum frames per step (lowered for short sessions)
	STABLE_MOVEMENT_THRESHOLD: 0.02,       // Movement threshold for stable frame
	MIN_STABLE_FRAMES: 2,                  // Minimum stable frames to use (lowered for robustness)
};

// Frame Selection Fallback Tiers
const FRAME_SELECTION_FALLBACKS = {
	TIER_1: 'stable_middle',               // Middle frame from stable segment
	TIER_2: 'stable_first',                // First stable frame if only 1
	TIER_3: 'lowest_movement',             // Frame with lowest movement
	TIER_4: 'segment_middle',              // Middle frame of entire segment
	TIER_5: 'any_frame',                   // Last resort - any frame
};

// Angle Analysis
const ANGLE_ANALYSIS_CONFIG = {
	KEYPOINT_CONFIDENCE_THRESHOLD: 0.35,
	MIN_ANGLE_DATA_POINTS: 3,              // Need at least 3 valid angles
};

/**
 * STAGE 1: ACTIVITY WINDOW DETECTION
 * 
 * Identifies when user starts actual yoga movement (ignores setup/idle frames)
 * More robust for short sessions than original
 */
function detectActivityWindowEnhanced(frameHistory) {
	if (!Array.isArray(frameHistory) || frameHistory.length < 8) {
		console.log('Activity Detection: Insufficient frames (<8), using entire history');
		return { startIndex: 0, endIndex: frameHistory.length - 1, method: 'fallback_insufficient' };
	}

	const { START_MOVEMENT_THRESHOLD, START_CONSECUTIVE_FRAMES, END_IDLE_THRESHOLD, END_IDLE_FRAMES, MIN_ACTIVITY_DURATION } = ACTIVITY_DETECTION_CONFIG;
	
	// Find activity start
	let activityStart = -1;
	for (let i = 0; i <= frameHistory.length - START_CONSECUTIVE_FRAMES; i++) {
		let activeCount = 0;
		for (let j = i; j < i + START_CONSECUTIVE_FRAMES; j++) {
			const movement = Number(frameHistory[j]?.movement) || 0;
			if (movement > START_MOVEMENT_THRESHOLD) activeCount++;
		}
		if (activeCount === START_CONSECUTIVE_FRAMES) {
			activityStart = i;
			break;
		}
	}

	// If no activity detected, use first frame
	if (activityStart === -1) {
		console.log('Activity Detection: No movement threshold crossing, using frame 0');
		return { startIndex: 0, endIndex: frameHistory.length - 1, method: 'no_activity_detected' };
	}

	// Find activity end (last frame before sustained idle)
	let activityEnd = frameHistory.length - 1;
	for (let i = frameHistory.length - END_IDLE_FRAMES; i >= activityStart; i--) {
		let idleCount = 0;
		for (let j = i; j < Math.min(i + END_IDLE_FRAMES, frameHistory.length); j++) {
			const movement = Number(frameHistory[j]?.movement) || 0;
			if (movement < END_IDLE_THRESHOLD) idleCount++;
		}
		if (idleCount >= END_IDLE_FRAMES - 2) {  // Allow 2-frame tolerance
			activityEnd = i - 1;
			break;
		}
	}

	// Validate activity duration
	const activityDuration = activityEnd - activityStart + 1;
	if (activityDuration < MIN_ACTIVITY_DURATION) {
		console.log(`Activity Detection: Duration too short (${activityDuration}), using entire history`);
		return { startIndex: 0, endIndex: frameHistory.length - 1, method: 'duration_too_short' };
	}

	return { 
		startIndex: Math.max(0, activityStart), 
		endIndex: Math.min(frameHistory.length - 1, activityEnd),
		method: 'detected',
		duration: activityDuration
	};
}

/**
 * STAGE 2: STATE MACHINE FILTERING
 * 
 * Enforces: WAITING → STEP1 → STEP2 → STEP3 → FINISHED
 * Returns frames in valid sequence only
 */
function filterWithStateMachine(frameHistory) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		return { frames: [], transitionIndices: {} };
	}

	let state = 'WAITING';
	const filtered = [];
	const transitionIndices = {
		waitingToStep1: -1,
		step1ToStep2: -1,
		step2ToStep3: -1,
		step3End: -1,
	};

	for (let i = 0; i < frameHistory.length; i++) {
		const step = frameHistory[i]?.step;

		if (state === 'WAITING' && step === 'step1') {
			state = 'STEP1';
			transitionIndices.waitingToStep1 = i;
			filtered.push(frameHistory[i]);
		} else if (state === 'STEP1') {
			if (step === 'step1') {
				filtered.push(frameHistory[i]);
			} else if (step === 'step2') {
				state = 'STEP2';
				transitionIndices.step1ToStep2 = i;
				filtered.push(frameHistory[i]);
			}
		} else if (state === 'STEP2') {
			if (step === 'step2') {
				filtered.push(frameHistory[i]);
			} else if (step === 'step3') {
				state = 'STEP3';
				transitionIndices.step2ToStep3 = i;
				filtered.push(frameHistory[i]);
			}
		} else if (state === 'STEP3') {
			if (step === 'step3') {
				filtered.push(frameHistory[i]);
				transitionIndices.step3End = i;
			}
			// Ignore all other steps after step3
		}
	}

	return { frames: filtered, transitionIndices };
}

/**
 * STAGE 3: SEGMENT EXTRACTION
 * 
 * Extracts separate segments for each step
 * Handles missing steps gracefully
 */
function extractStepSegments(frameHistory) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		return { step1: [], step2: [], step3: [] };
	}

	const segments = { step1: [], step2: [], step3: [] };
	const { MIN_SEGMENT_LENGTH } = SEGMENT_CONFIG;
	
	let currentStep = null;
	let currentSegment = [];

	for (const frame of frameHistory) {
		const step = frame?.step;

		if (step !== currentStep) {
			// Save previous segment if long enough
			if (currentSegment.length >= MIN_SEGMENT_LENGTH && segments.hasOwnProperty(currentStep)) {
				// Keep longest segment for each step
				if (currentSegment.length > segments[currentStep].length) {
					segments[currentStep] = [...currentSegment];
				}
			}
			currentStep = step;
			currentSegment = [frame];
		} else {
			currentSegment.push(frame);
		}
	}

	// Don't forget last segment
	if (currentSegment.length >= MIN_SEGMENT_LENGTH && segments.hasOwnProperty(currentStep)) {
		if (currentSegment.length > segments[currentStep].length) {
			segments[currentStep] = [...currentSegment];
		}
	}

	return segments;
}

/**
 * STAGE 4: SIGNIFICANT FRAME SELECTION WITH 4-TIER FALLBACK
 * 
 * Tier 1: Middle frame from stable (low-movement) frames
 * Tier 2: First stable frame if only one found
 * Tier 3: Frame with lowest movement in segment
 * Tier 4: Middle frame of entire segment
 * Tier 5: First frame as absolute fallback
 */
function selectSignificantFrameWithFallback(stepSegment) {
	if (!Array.isArray(stepSegment) || stepSegment.length === 0) {
		return { frame: null, tier: 'none', reason: 'empty_segment' };
	}

	const { STABLE_MOVEMENT_THRESHOLD, MIN_STABLE_FRAMES } = SEGMENT_CONFIG;

	// TIER 1: Middle frame from stable frames
	const stableFrames = stepSegment.filter(f => (Number(f?.movement) || 0) < STABLE_MOVEMENT_THRESHOLD);
	
	if (stableFrames.length >= MIN_STABLE_FRAMES) {
		const midIndex = Math.floor(stableFrames.length / 2);
		return { 
			frame: stableFrames[midIndex], 
			tier: FRAME_SELECTION_FALLBACKS.TIER_1,
			reason: `stable_middle (${stableFrames.length} stable frames)`
		};
	}

	// TIER 2: First stable frame if only 1 found
	if (stableFrames.length === 1) {
		return { 
			frame: stableFrames[0], 
			tier: FRAME_SELECTION_FALLBACKS.TIER_2,
			reason: 'only_one_stable_frame'
		};
	}

	// TIER 3: Frame with lowest movement
	const lowestMovementFrame = stepSegment.reduce((best, current) => {
		const currentMovement = Number(current?.movement) || 0;
		const bestMovement = Number(best?.movement) || 0;
		return currentMovement < bestMovement ? current : best;
	});
	
	if (lowestMovementFrame) {
		return { 
			frame: lowestMovementFrame, 
			tier: FRAME_SELECTION_FALLBACKS.TIER_3,
			reason: `lowest_movement_${(Number(lowestMovementFrame?.movement) || 0).toFixed(4)}`
		};
	}

	// TIER 4: Middle frame of segment
	const midIndex = Math.floor(stepSegment.length / 2);
	
	if (stepSegment[midIndex]) {
		return { 
			frame: stepSegment[midIndex], 
			tier: FRAME_SELECTION_FALLBACKS.TIER_4,
			reason: 'segment_middle'
		};
	}

	// TIER 5: Absolute fallback - first frame
	if (stepSegment[0]) {
		return { 
			frame: stepSegment[0], 
			tier: FRAME_SELECTION_FALLBACKS.TIER_5,
			reason: 'absolute_fallback'
		};
	}

	return { frame: null, tier: 'none', reason: 'no_frames_available' };
}

function hasUsablePoseData(frame) {
	if (!frame || !Array.isArray(frame.keypoints) || frame.keypoints.length < 34) {
		return false;
	}
	const validAngles = Array.isArray(frame.angles)
		? frame.angles.filter((value) => Number.isFinite(Number(value))).length
		: 0;
	return validAngles >= 3;
}

function pickBestFrameFromPool(framePool) {
	if (!Array.isArray(framePool) || framePool.length === 0) {
		return null;
	}

	const usableFrames = framePool.filter(hasUsablePoseData);
	const source = usableFrames.length > 0 ? usableFrames : framePool;

	return source.reduce((best, current) => {
		if (!best) {
			return current;
		}
		const bestMovement = Number(best?.movement);
		const currentMovement = Number(current?.movement);
		const bestScore = Number.isFinite(bestMovement) ? bestMovement : Number.POSITIVE_INFINITY;
		const currentScore = Number.isFinite(currentMovement) ? currentMovement : Number.POSITIVE_INFINITY;
		return currentScore < bestScore ? current : best;
	}, null);
}

function findStepFallbackFrame(stepKey, candidatePools) {
	for (const pool of candidatePools) {
		const stepFrames = (Array.isArray(pool) ? pool : []).filter((frame) => frame?.step === stepKey);
		const best = pickBestFrameFromPool(stepFrames);
		if (best) {
			return best;
		}
	}
	return null;
}

/**
 * STAGE 5: MAIN PIPELINE
 * 
 * Coordinates all processing and returns consistent frame selections
 */
function runEnhancedTemporalPipeline(frameHistory) {
	console.log('=== ENHANCED TEMPORAL PIPELINE START ===');
	console.log(`Input: ${frameHistory.length} frames`);

	// STAGE 1: Activity Detection
	const activityWindow = detectActivityWindowEnhanced(frameHistory);
	console.log(`Activity Window: frames ${activityWindow.startIndex}-${activityWindow.endIndex} (${activityWindow.endIndex - activityWindow.startIndex + 1} frames, method: ${activityWindow.method})`);
	
	const activeFrames = frameHistory.slice(activityWindow.startIndex, activityWindow.endIndex + 1);

	// STAGE 2: State Machine Filtering
	const { frames: validSequenceFrames, transitionIndices } = filterWithStateMachine(activeFrames);
	console.log(`Valid Sequence: ${validSequenceFrames.length} frames (${transitionIndices.step3End >= 0 ? 'all 3 steps' : 'incomplete sequence'})`);

	// STAGE 3: Step Segmentation
	const segments = extractStepSegments(validSequenceFrames);
	console.log(`Segments: step1=${segments.step1.length}, step2=${segments.step2.length}, step3=${segments.step3.length}`);

	// STAGE 4: Significant Frame Selection with Fallback
	const step1Selection = selectSignificantFrameWithFallback(segments.step1);
	const step2Selection = selectSignificantFrameWithFallback(segments.step2);
	const step3Selection = selectSignificantFrameWithFallback(segments.step3);

	const fallbackPools = [validSequenceFrames, activeFrames, frameHistory];
	if (!step1Selection.frame) {
		step1Selection.frame = findStepFallbackFrame('step1', fallbackPools);
		if (step1Selection.frame) {
			step1Selection.tier = 'cross_pool_fallback';
			step1Selection.reason = 'used broader pool for step1';
		}
	}
	if (!step2Selection.frame) {
		step2Selection.frame = findStepFallbackFrame('step2', fallbackPools);
		if (step2Selection.frame) {
			step2Selection.tier = 'cross_pool_fallback';
			step2Selection.reason = 'used broader pool for step2';
		}
	}
	if (!step3Selection.frame) {
		step3Selection.frame = findStepFallbackFrame('step3', fallbackPools);
		if (step3Selection.frame) {
			step3Selection.tier = 'cross_pool_fallback';
			step3Selection.reason = 'used broader pool for step3';
		}
	}

	if (segments.step1.length === 0 && step1Selection.frame) {
		segments.step1 = [step1Selection.frame];
	}
	if (segments.step2.length === 0 && step2Selection.frame) {
		segments.step2 = [step2Selection.frame];
	}
	if (segments.step3.length === 0 && step3Selection.frame) {
		segments.step3 = [step3Selection.frame];
	}

	console.log(`Frame Selection:`);
	console.log(`  step1: tier=${step1Selection.tier}, reason=${step1Selection.reason}`);
	console.log(`  step2: tier=${step2Selection.tier}, reason=${step2Selection.reason}`);
	console.log(`  step3: tier=${step3Selection.tier}, reason=${step3Selection.reason}`);

	// STAGE 5: Create consistent output object
	const result = {
		// Selected frames for all analyses
		frames: {
			step1: step1Selection.frame || null,
			step2: step2Selection.frame || null,
			step3: step3Selection.frame || null,
		},
		
		// Frame selection metadata
		selection: {
			step1: step1Selection,
			step2: step2Selection,
			step3: step3Selection,
		},
		
		// Segments for scoring and alternative analysis
		segments,
		
		// Activity and state machine info
		activityWindow,
		transitionIndices,
		validSequenceFrameCount: validSequenceFrames.length,
		
		// Debug logs
		debugInfo: {
			totalInputFrames: frameHistory.length,
			activeFrames: activeFrames.length,
			validSequenceFrames: validSequenceFrames.length,
		}
	};

	console.log('=== ENHANCED TEMPORAL PIPELINE END ===');
	return result;
}

/**
 * STAGE 6: TIMING ANALYSIS WITH SELECTED FRAMES
 * 
 * Uses timestamps of SELECTED significant frames, not all frames
 */
function buildTimingAnalysisFromSelectedFrames(selectedFrames, sessionStartTime, idealStepTimes) {
	const getFrameTimestamp = (frame) => {
		const ts = Number(frame?.timestamp);
		return Number.isFinite(ts) ? ts : null;
	};
	
	const step1Ts = getFrameTimestamp(selectedFrames?.step1);
	const step2Ts = getFrameTimestamp(selectedFrames?.step2);
	const step3Ts = getFrameTimestamp(selectedFrames?.step3);
	
	const fallbackReference = Number(sessionStartTime);
	const referenceTs = Number.isFinite(step1Ts)
		? step1Ts
		: Number.isFinite(fallbackReference)
			? fallbackReference
			: null;
	
	const toSeconds = (ts) => Number.isFinite(ts) && Number.isFinite(referenceTs) 
		? (ts - referenceTs) / 1000 
		: 0;

	const userStep1Time = toSeconds(step1Ts);
	const userStep2Time = toSeconds(step2Ts);
	const userStep3Time = toSeconds(step3Ts);

	const idealStep1Time = Number.isFinite(idealStepTimes?.idealStep1Time) ? idealStepTimes.idealStep1Time : null;
	const idealStep2Time = Number.isFinite(idealStepTimes?.idealStep2Time) ? idealStepTimes.idealStep2Time : null;
	const idealStep3Time = Number.isFinite(idealStepTimes?.idealStep3Time) ? idealStepTimes.idealStep3Time : null;

	const safeSubtract = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? a - b : null;

	return {
		sessionStartReferenceTimestampMs: referenceTs,
		step1FrameTimestampMs: step1Ts,
		step2FrameTimestampMs: step2Ts,
		step3FrameTimestampMs: step3Ts,
		userStep1Time,
		userStep2Time,
		userStep3Time,
		idealStep1Time,
		idealStep2Time,
		idealStep3Time,
		delayStep1: safeSubtract(userStep1Time, idealStep1Time),
		delayStep2: safeSubtract(userStep2Time, idealStep2Time),
		delayStep3: safeSubtract(userStep3Time, idealStep3Time),
	};
}

/**
 * STAGE 7: ANGLE VALIDATION & SAFE ANALYSIS
 * 
 * Validates angles exist and are valid before returning
 */
function validateAndGetAngles(frame) {
	if (!frame) return { angles: null, valid: false, reason: 'frame_null' };
	
	const angles = frame?.angles;
	
	if (!Array.isArray(angles)) {
		return { angles: null, valid: false, reason: 'angles_not_array' };
	}
	
	const validAngles = angles.filter(a => Number.isFinite(Number(a)));
	
	if (validAngles.length < ANGLE_ANALYSIS_CONFIG.MIN_ANGLE_DATA_POINTS) {
		return { angles: null, valid: false, reason: `insufficient_angles_${validAngles.length}` };
	}
	
	return { angles: validAngles, valid: true, reason: 'valid' };
}

/**
 * HELPER FUNCTIONS FOR SCORING
 * 
 * These are shared by sessionScoringPipeline.js
 */

function clampScore(value) {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(100, value));
}

function calculateStepAccuracyScore(stepFrames) {
	if (!Array.isArray(stepFrames) || !stepFrames.length) {
		return 0;
	}

	const total = stepFrames.length;
	const correct = stepFrames.filter((frame) => frame?.label === 'correct').length;
	const moderate = stepFrames.filter((frame) => frame?.label === 'moderate').length;
	const incorrect = stepFrames.filter((frame) => frame?.label === 'incorrect').length;

	const normalized = (correct * 1 + moderate * 0.6 + incorrect * 0.2) / total;
	return clampScore(normalized * 100);
}

function calculateAngleAccuracyScore(stepAngleInfo) {
	const averageError = Number(stepAngleInfo?.averageError);
	if (!Number.isFinite(averageError)) {
		return 0;
	}

	// 0 degree error -> 100 score, 30+ degree error -> 0 score.
	return clampScore((1 - Math.min(averageError, 30) / 30) * 100);
}

function calculateTimingScoreForStep(delaySeconds) {
	const delay = Number(delaySeconds);
	if (!Number.isFinite(delay)) {
		return null;
	}

	const absDelay = Math.abs(delay);
	// 0s delay -> 100 score, 10s or more -> 0 score.
	return clampScore((1 - Math.min(absDelay, 10) / 10) * 100);
}

function calculateStabilityScore(stepFrames) {
	if (!Array.isArray(stepFrames) || !stepFrames.length) {
		return null;
	}

	const movements = stepFrames
		.map((frame) => Number(frame?.movement))
		.filter((value) => Number.isFinite(value));

	if (!movements.length) {
		return null;
	}

	const averageMovement = movements.reduce((sum, value) => sum + value, 0) / movements.length;
	// 0 movement -> 100 score, 0.12+ movement -> 0 score.
	return clampScore((1 - Math.min(averageMovement, 0.12) / 0.12) * 100);
}

function computeNormalizedWeightedScore(parts) {
	const validParts = parts.filter((part) => Number.isFinite(part?.score) && Number.isFinite(part?.weight) && part.weight > 0);
	if (!validParts.length) {
		return 0;
	}

	const weightedTotal = validParts.reduce((sum, part) => sum + (part.score * part.weight), 0);
	const weightTotal = validParts.reduce((sum, part) => sum + part.weight, 0);
	if (!Number.isFinite(weightTotal) || weightTotal <= 0) {
		return 0;
	}

	return clampScore(weightedTotal / weightTotal);
}

/**
 * EXPORT
 */
export { 
	runEnhancedTemporalPipeline, 
	buildTimingAnalysisFromSelectedFrames,
	validateAndGetAngles,
	selectSignificantFrameWithFallback,
	filterWithStateMachine,
	extractStepSegments,
	detectActivityWindowEnhanced,
	calculateStepAccuracyScore,
	calculateAngleAccuracyScore,
	calculateTimingScoreForStep,
	calculateStabilityScore,
	computeNormalizedWeightedScore,
	clampScore,
};

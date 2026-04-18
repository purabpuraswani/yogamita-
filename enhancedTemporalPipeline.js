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
	PRESERVE_TAIL_FRAMES: 10,              // Always preserve last N frames to avoid losing final STEP3
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
	TIER_0: 'quality_score',               // Composite score (confidence + angle + movement)
	TIER_1: 'stable_middle',               // Middle frame from stable segment
	TIER_2: 'stable_first',                // First stable frame if only 1
	TIER_3: 'lowest_movement',             // Frame with lowest movement
	TIER_4: 'segment_middle',              // Middle frame of entire segment
	TIER_5: 'any_frame',                   // Last resort - any frame
};

const FRAME_QUALITY_CONFIG = {
	MIN_CONFIDENCE: 0.5,
	CONFIDENCE_WEIGHT: 0.5,
	ANGLE_WEIGHT: 0.3,
	MOVEMENT_WEIGHT: 0.2,
	BASE_TOLERANCE_DEGREES: 10,
	STEP2_TOLERANCE_MULTIPLIER: 1.2,
	MAX_ACCEPTABLE_ANGLE_ERROR: 35,
	TOP_K_FRAMES: 3,
};

const ANGLE_INDEX = {
	LEFT_SHOULDER: 2,
	RIGHT_SHOULDER: 3,
	SPINE: 7,
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

function mergePreservedTailFrames(activeFrames, frameHistory) {
	const preserveCount = Math.max(0, Number(ACTIVITY_DETECTION_CONFIG.PRESERVE_TAIL_FRAMES) || 0);
	if (!Array.isArray(activeFrames) || !Array.isArray(frameHistory) || preserveCount <= 0) {
		return Array.isArray(activeFrames) ? activeFrames : [];
	}

	const tailFrames = frameHistory.slice(-preserveCount);
	if (!tailFrames.length) {
		return activeFrames;
	}

	const seen = new Set();
	const merged = [];
	for (const frame of [...activeFrames, ...tailFrames]) {
		const ts = Number(frame?.timestamp);
		const key = Number.isFinite(ts) ? `ts:${ts}` : `idx:${merged.length}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(frame);
	}

	return merged.sort((left, right) => (Number(left?.timestamp) || 0) - (Number(right?.timestamp) || 0));
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
function selectSignificantFrameWithFallback(stepSegment, stepKey = null, idealPoseReference = null) {
	if (!Array.isArray(stepSegment) || stepSegment.length === 0) {
		return { frame: null, tier: 'none', reason: 'empty_segment' };
	}

	const scoredFrames = stepSegment
		.map((frame) => ({ frame, ...computeRepresentativeFrameScore(frame, stepKey, idealPoseReference) }))
		.filter((entry) => !entry.rejected && Number.isFinite(entry.score));

	if (scoredFrames.length > 0) {
		const ranked = [...scoredFrames].sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			// Optional peak detection: prefer minimum angle deviation when scores tie.
			const leftAngle = Number.isFinite(left.angleError) ? left.angleError : Number.POSITIVE_INFINITY;
			const rightAngle = Number.isFinite(right.angleError) ? right.angleError : Number.POSITIVE_INFINITY;
			if (leftAngle !== rightAngle) {
				return leftAngle - rightAngle;
			}
			return (Number(left.frame?.movement) || 0) - (Number(right.frame?.movement) || 0);
		});

		const topEntries = ranked.slice(0, Math.min(FRAME_QUALITY_CONFIG.TOP_K_FRAMES, ranked.length));
		const topFrames = topEntries.map((entry) => entry.frame);
		const averagedAngles = averageAnglesFromFrames(topFrames);
		const representative = {
			...topFrames[0],
			angles: Array.isArray(averagedAngles) ? averagedAngles : topFrames[0]?.angles,
			representativeTopFrames: topFrames,
		};

		return {
			frame: representative,
			topFrames,
			topEntries,
			averagedAngles,
			tier: FRAME_SELECTION_FALLBACKS.TIER_0,
			reason: `quality_score_top${topFrames.length}`,
		};
	}

	const { STABLE_MOVEMENT_THRESHOLD, MIN_STABLE_FRAMES } = SEGMENT_CONFIG;
	const stableThreshold = stepKey === 'step2'
		? STABLE_MOVEMENT_THRESHOLD * 1.2
		: stepKey === 'step3'
			? STABLE_MOVEMENT_THRESHOLD * 2
			: STABLE_MOVEMENT_THRESHOLD;
	const minStableFrames = stepKey === 'step3' ? 1 : MIN_STABLE_FRAMES;

	// TIER 1: Middle frame from stable frames
	const stableFrames = stepSegment.filter(f => (Number(f?.movement) || 0) < stableThreshold);
	
	if (stableFrames.length >= minStableFrames) {
		const midIndex = Math.floor(stableFrames.length / 2);
		return { 
			frame: stableFrames[midIndex], 
			topFrames: [stableFrames[midIndex]],
			averagedAngles: Array.isArray(stableFrames[midIndex]?.angles) ? stableFrames[midIndex].angles : null,
			tier: FRAME_SELECTION_FALLBACKS.TIER_1,
			reason: `stable_middle (${stableFrames.length} stable frames)`
		};
	}

	// TIER 2: First stable frame if only 1 found
	if (stableFrames.length === 1) {
		return { 
			frame: stableFrames[0], 
			topFrames: [stableFrames[0]],
			averagedAngles: Array.isArray(stableFrames[0]?.angles) ? stableFrames[0].angles : null,
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
			topFrames: [lowestMovementFrame],
			averagedAngles: Array.isArray(lowestMovementFrame?.angles) ? lowestMovementFrame.angles : null,
			tier: FRAME_SELECTION_FALLBACKS.TIER_3,
			reason: `lowest_movement_${(Number(lowestMovementFrame?.movement) || 0).toFixed(4)}`
		};
	}

	// TIER 4: Middle frame of segment
	const midIndex = Math.floor(stepSegment.length / 2);
	
	if (stepSegment[midIndex]) {
		return { 
			frame: stepSegment[midIndex], 
			topFrames: [stepSegment[midIndex]],
			averagedAngles: Array.isArray(stepSegment[midIndex]?.angles) ? stepSegment[midIndex].angles : null,
			tier: FRAME_SELECTION_FALLBACKS.TIER_4,
			reason: 'segment_middle'
		};
	}

	// TIER 5: Absolute fallback - first frame
	if (stepSegment[0]) {
		return { 
			frame: stepSegment[0], 
			topFrames: [stepSegment[0]],
			averagedAngles: Array.isArray(stepSegment[0]?.angles) ? stepSegment[0].angles : null,
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

function getCalibratedFrameConfidence(frame) {
	const rawConfidence = Math.min(1, Math.max(0, Number(frame?.confidence) || 0));
	const stabilityScore = Math.min(1, Math.max(0, Number(frame?.stabilityScore) || 0));
	return Math.min(1, Math.max(0, rawConfidence * (0.55 + (0.45 * stabilityScore))));
}

function toFiniteNumber(value) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : null;
}

function computeAngleDifference(userAngle, idealAngle) {
	const user = toFiniteNumber(userAngle);
	const ideal = toFiniteNumber(idealAngle);
	if (user === null || ideal === null) {
		return null;
	}

	let diff = Math.abs(user - ideal);
	if (diff > 180) {
		diff = 360 - diff;
	}
	return diff;
}

function computeFrameAngleError(frame, stepKey, idealPoseReference) {
	const frameAngles = Array.isArray(frame?.angles) ? frame.angles : null;
	const idealAngles = Array.isArray(idealPoseReference?.[stepKey]?.idealAngles) ? idealPoseReference[stepKey].idealAngles : null;
	if (!frameAngles || !idealAngles || !frameAngles.length || !idealAngles.length) {
		return null;
	}

	const jointCount = Math.min(frameAngles.length, idealAngles.length);
	if (jointCount < 3) {
		return null;
	}

	const tolerance = FRAME_QUALITY_CONFIG.BASE_TOLERANCE_DEGREES * (stepKey === 'step2' ? FRAME_QUALITY_CONFIG.STEP2_TOLERANCE_MULTIPLIER : 1);
	const maxAllowedError = FRAME_QUALITY_CONFIG.MAX_ACCEPTABLE_ANGLE_ERROR * (stepKey === 'step2' ? FRAME_QUALITY_CONFIG.STEP2_TOLERANCE_MULTIPLIER : 1);

	let weightedErrorSum = 0;
	let weightSum = 0;

	for (let i = 0; i < jointCount; i += 1) {
		const rawDiff = computeAngleDifference(frameAngles[i], idealAngles[i]);
		if (!Number.isFinite(rawDiff)) {
			continue;
		}

		let jointWeight = 1;
		if (stepKey === 'step2' && (i === ANGLE_INDEX.LEFT_SHOULDER || i === ANGLE_INDEX.RIGHT_SHOULDER || i === ANGLE_INDEX.SPINE)) {
			jointWeight = 1.5;
		}

		const adjustedDiff = Math.max(0, rawDiff - tolerance);
		weightedErrorSum += adjustedDiff * jointWeight;
		weightSum += jointWeight;
	}

	if (weightSum <= 0) {
		return null;
	}

	const weightedAngleError = weightedErrorSum / weightSum;
	return {
		weightedAngleError,
		maxAllowedError,
	};
}

function computeRepresentativeFrameScore(frame, stepKey, idealPoseReference) {
	const confidence = Math.min(1, Math.max(0, Number(frame?.confidence) || 0));
	const minConfidence = stepKey === 'step3'
		? Math.max(0.35, FRAME_QUALITY_CONFIG.MIN_CONFIDENCE - 0.12)
		: FRAME_QUALITY_CONFIG.MIN_CONFIDENCE;
	if (confidence < minConfidence) {
		return { score: Number.NEGATIVE_INFINITY, rejected: true, reason: 'low_confidence', angleError: null };
	}

	const movement = Math.max(0, Number(frame?.movement) || 0);
	const angleMeta = computeFrameAngleError(frame, stepKey, idealPoseReference);
	if (!angleMeta || !Number.isFinite(angleMeta.weightedAngleError)) {
		return { score: Number.NEGATIVE_INFINITY, rejected: true, reason: 'angle_unavailable', angleError: null };
	}

	const maxAllowedError = stepKey === 'step3' ? angleMeta.maxAllowedError * 1.2 : angleMeta.maxAllowedError;
	if (angleMeta.weightedAngleError > maxAllowedError) {
		return { score: Number.NEGATIVE_INFINITY, rejected: true, reason: 'high_angle_error', angleError: angleMeta.weightedAngleError };
	}

	const score =
		(confidence * FRAME_QUALITY_CONFIG.CONFIDENCE_WEIGHT) +
		((1 / (angleMeta.weightedAngleError + 1)) * FRAME_QUALITY_CONFIG.ANGLE_WEIGHT) +
		((1 / (movement + 1)) * FRAME_QUALITY_CONFIG.MOVEMENT_WEIGHT);

	return {
		score,
		rejected: false,
		reason: 'ok',
		angleError: angleMeta.weightedAngleError,
	};
}

function averageAnglesFromFrames(frames) {
	if (!Array.isArray(frames) || !frames.length) {
		return null;
	}

	const maxLength = Math.max(...frames.map((frame) => (Array.isArray(frame?.angles) ? frame.angles.length : 0)));
	if (!Number.isFinite(maxLength) || maxLength <= 0) {
		return null;
	}

	const averaged = [];
	for (let i = 0; i < maxLength; i += 1) {
		const values = frames
			.map((frame) => toFiniteNumber(frame?.angles?.[i]))
			.filter((value) => value !== null);
		if (!values.length) {
			averaged.push(null);
			continue;
		}
		averaged.push(values.reduce((sum, value) => sum + value, 0) / values.length);
	}

	return averaged;
}

function pickBestFrameFromPool(framePool, stepKey = null, idealPoseReference = null) {
	if (!Array.isArray(framePool) || framePool.length === 0) {
		return null;
	}

	const usableFrames = framePool.filter(hasUsablePoseData);
	const source = usableFrames.length > 0 ? usableFrames : framePool;

	const scored = source
		.map((frame) => ({ frame, ...computeRepresentativeFrameScore(frame, stepKey, idealPoseReference) }))
		.filter((entry) => !entry.rejected && Number.isFinite(entry.score))
		.sort((left, right) => right.score - left.score);

	if (scored.length) {
		return scored[0].frame;
	}

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

function findStepFallbackFrame(stepKey, candidatePools, idealPoseReference = null) {
	for (const pool of candidatePools) {
		const stepFrames = (Array.isArray(pool) ? pool : []).filter((frame) => frame?.step === stepKey);
		const best = pickBestFrameFromPool(stepFrames, stepKey, idealPoseReference);
		if (best) {
			return best;
		}
	}
	return null;
}

function synthesizeStep3FromTail(activeFrames, existingSegments, idealPoseReference = null) {
	if (!Array.isArray(activeFrames) || !activeFrames.length) {
		return [];
	}
	if (Array.isArray(existingSegments?.step3) && existingSegments.step3.length) {
		return existingSegments.step3;
	}

	const tailCount = Math.max(3, Number(ACTIVITY_DETECTION_CONFIG.PRESERVE_TAIL_FRAMES) || 10);
	const tail = activeFrames.slice(-tailCount);
	const candidates = tail.filter((frame) => {
		const movement = Number(frame?.movement) || 0;
		const hasAngles = Array.isArray(frame?.angles) && frame.angles.some((value) => Number.isFinite(Number(value)));
		return hasAngles && movement <= (SEGMENT_CONFIG.STABLE_MOVEMENT_THRESHOLD * 2.8);
	});

	if (!candidates.length) {
		return [];
	}

	const scored = candidates
		.map((frame) => ({ frame, ...computeRepresentativeFrameScore({ ...frame, step: 'step3' }, 'step3', idealPoseReference) }))
		.filter((entry) => !entry.rejected && Number.isFinite(entry.score))
		.sort((left, right) => right.score - left.score);

	const source = scored.length ? scored.map((entry) => entry.frame) : candidates;
	const picked = source.slice(0, Math.max(3, Math.min(source.length, 6)));
	return picked.map((frame) => ({ ...frame, step: 'step3', smoothedStep: 'step3' }));
}

/**
 * STAGE 5: MAIN PIPELINE
 * 
 * Coordinates all processing and returns consistent frame selections
 */
function runEnhancedTemporalPipeline(frameHistory, idealPoseReference = null) {
	console.log('=== ENHANCED TEMPORAL PIPELINE START ===');
	console.log(`Input: ${frameHistory.length} frames`);

	const toFrameSummary = (entry, index) => {
		const frame = entry?.frame || null;
		return {
			rank: index + 1,
			step: frame?.step || null,
			timestamp: Number(frame?.timestamp) || null,
			movement: Number.isFinite(Number(frame?.movement)) ? Number(Number(frame.movement).toFixed(4)) : null,
			confidence: Number.isFinite(Number(frame?.confidence)) ? Number(Number(frame.confidence).toFixed(3)) : null,
			qualityScore: Number.isFinite(Number(entry?.score)) ? Number(Number(entry.score).toFixed(4)) : null,
			angleError: Number.isFinite(Number(entry?.angleError)) ? Number(Number(entry.angleError).toFixed(2)) : null,
		};
	};

	const logSelectionDiagnostics = (stepKey, selection) => {
		const topEntries = Array.isArray(selection?.topEntries) ? selection.topEntries : [];
		if (topEntries.length > 0) {
			console.log(`[REP FRAME TOP3] ${stepKey}`, topEntries.slice(0, 3).map((entry, index) => toFrameSummary(entry, index)));
		}
		if (selection?.frame?.step && selection.frame.step !== stepKey) {
			console.warn(`[REP FRAME MISMATCH] expected=${stepKey} selected=${selection.frame.step} tier=${selection.tier} reason=${selection.reason}`);
		}
	};

	// STAGE 1: Activity Detection
	const activityWindow = detectActivityWindowEnhanced(frameHistory);
	console.log(`Activity Window: frames ${activityWindow.startIndex}-${activityWindow.endIndex} (${activityWindow.endIndex - activityWindow.startIndex + 1} frames, method: ${activityWindow.method})`);
	
	const detectedActiveFrames = frameHistory.slice(activityWindow.startIndex, activityWindow.endIndex + 1);
	const activeFrames = mergePreservedTailFrames(detectedActiveFrames, frameHistory);
	if (activeFrames.length !== detectedActiveFrames.length) {
		console.log(`Tail preserve: ${detectedActiveFrames.length} -> ${activeFrames.length} frames (kept last ${ACTIVITY_DETECTION_CONFIG.PRESERVE_TAIL_FRAMES})`);
	}

	// STAGE 2: State Machine Filtering
	const { frames: validSequenceFrames, transitionIndices } = filterWithStateMachine(activeFrames);
	console.log(`Valid Sequence: ${validSequenceFrames.length} frames (${transitionIndices.step3End >= 0 ? 'all 3 steps' : 'incomplete sequence'})`);
	console.log('[STEP SEGMENT DEBUG] Active frame labels:', activeFrames.map((frame, index) => ({
		idx: index,
		step: frame?.step || null,
		confidence: Number.isFinite(Number(frame?.confidence)) ? Number(Number(frame.confidence).toFixed(3)) : null,
		movement: Number.isFinite(Number(frame?.movement)) ? Number(Number(frame.movement).toFixed(4)) : null,
	})).slice(-Math.min(30, activeFrames.length)));

	// STAGE 3: Step Segmentation
	const segments = extractStepSegments(validSequenceFrames);
	if (!segments.step3.length) {
		const recoveredStep3 = synthesizeStep3FromTail(activeFrames, segments, idealPoseReference);
		if (recoveredStep3.length) {
			segments.step3 = recoveredStep3;
			console.warn(`[STEP3 FALLBACK] Recovered ${recoveredStep3.length} STEP3 tail frames from session end.`);
		}
	}
	console.log(`Segments: step1=${segments.step1.length}, step2=${segments.step2.length}, step3=${segments.step3.length}`);
 	console.log('[STEP COUNTS]', {
		step1: segments.step1.length,
		step2: segments.step2.length,
		step3: segments.step3.length,
	});

	// STAGE 4: Significant Frame Selection with Fallback
	const step1Selection = selectSignificantFrameWithFallback(segments.step1, 'step1', idealPoseReference);
	const step2Selection = selectSignificantFrameWithFallback(segments.step2, 'step2', idealPoseReference);
	const step3Selection = selectSignificantFrameWithFallback(segments.step3, 'step3', idealPoseReference);

	const fallbackPools = [validSequenceFrames, activeFrames, frameHistory];
	if (!step1Selection.frame) {
		step1Selection.frame = findStepFallbackFrame('step1', fallbackPools, idealPoseReference);
		if (step1Selection.frame) {
			step1Selection.tier = 'cross_pool_fallback';
			step1Selection.reason = 'used broader pool for step1';
		}
	}
	if (!step2Selection.frame) {
		step2Selection.frame = findStepFallbackFrame('step2', fallbackPools, idealPoseReference);
		if (step2Selection.frame) {
			step2Selection.tier = 'cross_pool_fallback';
			step2Selection.reason = 'used broader pool for step2';
		}
	}
	if (!step3Selection.frame) {
		step3Selection.frame = findStepFallbackFrame('step3', fallbackPools, idealPoseReference);
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
	logSelectionDiagnostics('step1', step1Selection);
	logSelectionDiagnostics('step2', step2Selection);
	logSelectionDiagnostics('step3', step3Selection);

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
	const earliestSelectedTs = [step1Ts, step2Ts, step3Ts]
		.filter((value) => Number.isFinite(value))
		.sort((left, right) => left - right)[0] ?? null;
	const referenceTs = Number.isFinite(step1Ts)
		? step1Ts
		: Number.isFinite(earliestSelectedTs)
			? earliestSelectedTs
		: Number.isFinite(fallbackReference)
			? fallbackReference
			: null;
	
	const toSeconds = (ts) => Number.isFinite(ts) && Number.isFinite(referenceTs)
		? Math.max(0, (ts - referenceTs) / 1000)
		: null;

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

	const weighted = stepFrames.map((frame) => {
		const confidence = getCalibratedFrameConfidence(frame);
		const stepBoost = frame?.step === 'step2' ? 1.05 : 1;
		return {
			label: frame?.label,
			weight: Math.max(0.1, confidence * stepBoost),
		};
	});

	const total = weighted.reduce((sum, item) => sum + item.weight, 0);
	const correct = weighted.filter((item) => item.label === 'correct').reduce((sum, item) => sum + item.weight, 0);
	const moderate = weighted.filter((item) => item.label === 'moderate').reduce((sum, item) => sum + item.weight, 0);
	const incorrect = weighted.filter((item) => item.label === 'incorrect').reduce((sum, item) => sum + item.weight, 0);

	// Lenient mapping for beginners/sedentary users: treat moderate as near-correct and
	// avoid collapsing score when many early frames are marked incorrect.
	const normalized = (correct * 1 + moderate * 0.75 + incorrect * 0.4) / total;
	return clampScore(normalized * 100);
}

function calculateAngleAccuracyScore(stepAngleInfo) {
	const averageError = Number(stepAngleInfo?.weightedAverageError ?? stepAngleInfo?.averageError ?? stepAngleInfo?.rawAverageError);
	if (!Number.isFinite(averageError)) {
		return 0;
	}

	// Make angle penalty less steep: 0 error => 100, 45+ degrees => 0.
	const cappedPenalty = Math.min(Math.max(0, averageError), 45);
	return clampScore(100 - ((cappedPenalty / 45) * 100));
}

function calculateTimingScoreForStep(delaySeconds) {
	const delay = Number(delaySeconds);
	if (!Number.isFinite(delay)) {
		return null;
	}

	const absDelay = Math.abs(delay);
	// 0s delay -> 100 score, 14s or more -> 0 score (more tolerant pacing).
	return clampScore((1 - Math.min(absDelay, 14) / 14) * 100);
}

function calculateStabilityScore(stepFrames) {
	if (!Array.isArray(stepFrames) || !stepFrames.length) {
		return null;
	}

	const movements = [...stepFrames]
		.filter((frame) => Number.isFinite(Number(frame?.movement)))
		.sort((left, right) => {
			const movementDiff = (Number(left?.movement) || 0) - (Number(right?.movement) || 0);
			if (movementDiff !== 0) {
				return movementDiff;
			}
			return getCalibratedFrameConfidence(right) - getCalibratedFrameConfidence(left);
		})
		.slice(0, Math.min(3, stepFrames.length));

	if (!movements.length) {
		return null;
	}

	const weightedMovements = movements.map((frame) => ({
		movement: Number(frame?.movement) || 0,
		weight: Math.max(0.1, getCalibratedFrameConfidence(frame)),
	}));
	const weightTotal = weightedMovements.reduce((sum, item) => sum + item.weight, 0);
	const averageMovement = weightedMovements.reduce((sum, item) => sum + (item.movement * item.weight), 0) / weightTotal;
	// 0 movement -> 100 score, 0.24+ movement -> 0 score (less strict).
	return clampScore(100 - ((Math.min(averageMovement, 0.24) / 0.24) * 100));
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

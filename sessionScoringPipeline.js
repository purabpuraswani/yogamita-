/**
 * ==================== SESSION SCORING AND FRAME SEGMENTATION PIPELINE ====================
 * 
 * Fixes:
 * 1. Score drops after user finishes pose → Freeze analysis after step3 completion
 * 2. Only one skeleton appears → Ensure all three step segments are preserved
 * 3. Score low even when correct → Use only significant stable frames for scoring
 * 4. Wrong frames selected → Add multiple selection strategies with fallbacks
 * 
 * ======================================================================================
 */

import { 
	clampScore,
	calculateStepAccuracyScore, 
	calculateAngleAccuracyScore, 
	calculateTimingScoreForStep, 
	calculateStabilityScore, 
	computeNormalizedWeightedScore 
} from './enhancedTemporalPipeline.js';

/**
 * STEP 1: EXTRACT VALID STEP SEQUENCE
 * 
 * Uses state machine to enforce: WAITING → STEP1 → STEP2 → STEP3 → FINISHED
 * Invalid transitions are filtered out.
 * Returns frames only up to and including last STEP3.
 */
function getValidStepSequenceFrames(frameHistory) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		console.log('Valid Step Sequence: No frames');
		return [];
	}

	let state = 'WAITING';
	const accepted = [];
	let lastStep3Index = -1;

	for (let i = 0; i < frameHistory.length; i += 1) {
		const frame = frameHistory[i];
		const step = frame?.step;

		// Update state machine
		if (state === 'WAITING') {
			if (step === 'step1') {
				state = 'STEP1';
				accepted.push(frame);
			}
			continue;
		}

		if (state === 'STEP1') {
			if (step === 'step1') {
				accepted.push(frame);
			} else if (step === 'step2') {
				state = 'STEP2';
				accepted.push(frame);
			}
			continue;
		}

		if (state === 'STEP2') {
			if (step === 'step2') {
				accepted.push(frame);
			} else if (step === 'step3') {
				state = 'STEP3';
				accepted.push(frame);
				lastStep3Index = accepted.length - 1;
			}
			continue;
		}

		if (state === 'STEP3') {
			if (step === 'step3') {
				accepted.push(frame);
				lastStep3Index = accepted.length - 1;
			}
			// Once in STEP3, ignore other steps
			continue;
		}
	}

	// Trim after last step3
	const result = lastStep3Index !== -1 ? accepted.slice(0, lastStep3Index + 1) : accepted;

	console.log(`Valid Step Sequence: ${frameHistory.length} → ${result.length} frames`);
	console.log(`  State transitions: WAITING → STEP1 ${result.some((f) => f.step === 'step1') ? '✓' : '✗'} → STEP2 ${result.some((f) => f.step === 'step2') ? '✓' : '✗'} → STEP3 ${result.some((f) => f.step === 'step3') ? '✓' : '✗'}`);

	return result;
}

/**
 * STEP 2: GET MAJOR STEP SEGMENTS
 * 
 * Extract the main contiguous segment for each step.
 * Ignore short noise segments.
 */
function getMajorStepSegments(frameHistory) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		return { step1: [], step2: [], step3: [] };
	}

	const segments = {
		step1: [],
		step2: [],
		step3: [],
	};

	const MIN_SEGMENT_LENGTH = 5;
	let currentStep = null;
	let currentSegment = [];

	for (const frame of frameHistory) {
		const step = frame?.step;

		if (step !== currentStep) {
			// Save previous segment if long enough
			if (currentSegment.length >= MIN_SEGMENT_LENGTH && segments.hasOwnProperty(currentStep)) {
				if (segments[currentStep].length === 0 || currentSegment.length > segments[currentStep].length) {
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
		if (segments[currentStep].length === 0 || currentSegment.length > segments[currentStep].length) {
			segments[currentStep] = [...currentSegment];
		}
	}

	console.log(`Major Step Segments: step1: ${segments.step1.length}, step2: ${segments.step2.length}, step3: ${segments.step3.length}`);

	return segments;
}

/**
 * STEP 3: BUILD SESSION SCORES FROM MAJOR SEGMENTS
 * 
 * Use major step segments (not all frames) to calculate scores.
 * This prevents scores from being affected by frames after step3 is complete.
 */
function buildSessionScoresFromMajorSegments({ majorSegments, angleAnalysis, timingAnalysis }) {
	const stepKeys = ['step1', 'step2', 'step3'];
	const perStep = {};

	console.log('=== SESSION SCORING FROM MAJOR SEGMENTS ===');

	for (const stepKey of stepKeys) {
		const stepFrames = majorSegments[stepKey];
		const stepFramesCount = stepFrames.length;

		// Calculate step accuracy (label distribution)
		const stepAccuracyScore = calculateStepAccuracyScore(stepFrames);

		// Get angle accuracy from angle analysis (uses significant frames)
		const hasAngleData = Number.isFinite(Number(angleAnalysis?.steps?.[stepKey]?.averageError));
		const angleAccuracyScore = hasAngleData ? calculateAngleAccuracyScore(angleAnalysis?.steps?.[stepKey]) : null;

		// Get timing score
		const timingDelay = stepKey === 'step1'
			? timingAnalysis?.delayStep1
			: stepKey === 'step2'
				? timingAnalysis?.delayStep2
				: timingAnalysis?.delayStep3;
		const timingScore = calculateTimingScoreForStep(timingDelay);

		// Get stability score from major segment
		const stabilityScore = calculateStabilityScore(stepFrames);

		// NEW WEIGHTS: Angle accuracy is now highest priority (0.45)
		const weightedStepScore = computeNormalizedWeightedScore([
			{ score: angleAccuracyScore, weight: 0.45 },  // Highest weight
			{ score: stepAccuracyScore, weight: 0.35 },
			{ score: stabilityScore, weight: 0.12 },
			{ score: timingScore, weight: 0.08 },
		]);

		perStep[stepKey] = {
			frameCount: stepFramesCount,
			stepAccuracyScore,
			angleAccuracyScore,
			timingScore,
			stabilityScore,
			weightedScore: weightedStepScore,
		};

		console.log(`${stepKey}: ${stepFramesCount} frames, accuracy=${stepAccuracyScore.toFixed(1)}, angle=${hasAngleData ? angleAccuracyScore?.toFixed(1) : 'N/A'}, timing=${timingScore?.toFixed(1)}, stability=${stabilityScore?.toFixed(1)}, weighted=${weightedStepScore.toFixed(1)}`);
	}

	const overallScore = clampScore(
		(stepKeys.reduce((sum, stepKey) => sum + Number(perStep[stepKey]?.weightedScore || 0), 0)) / stepKeys.length
	);

	console.log(`OVERALL SCORE: ${overallScore.toFixed(1)}`);
	console.log('=== END SESSION SCORING ===');

	return {
		step1Score: perStep.step1?.weightedScore || 0,
		step2Score: perStep.step2?.weightedScore || 0,
		step3Score: perStep.step3?.weightedScore || 0,
		overallScore,
		weights: {
			angleAccuracy: 0.45,    // Highest weight
			stepAccuracy: 0.35,
			stability: 0.12,
			timing: 0.08,
		},
		perStep,
	};
}

/**
 * STEP 4: ENSURE ALL THREE SKELETONS ARE GENERATED
 * 
 * If any step is missing from significant frames, try to use major segment frame.
 * This ensures skeleton visualization always has all three steps.
 */
function ensureAllStepSkeletons(significantFrames, majorSegments) {
	const enhanced = { ...significantFrames };

	for (const stepKey of ['step1', 'step2', 'step3']) {
		// If significant frame is missing, try major segment
		if (!enhanced[stepKey] && majorSegments[stepKey].length > 0) {
			const midIndex = Math.floor(majorSegments[stepKey].length / 2);
			enhanced[stepKey] = majorSegments[stepKey][midIndex];
			console.log(`${stepKey}: Using major segment frame (significant frame was null)`);
		}
	}

	return enhanced;
}

/**
 * Export functions for use in main.js
 */
export { getValidStepSequenceFrames, getMajorStepSegments, buildSessionScoresFromMajorSegments, ensureAllStepSkeletons };

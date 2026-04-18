const LABELS = ['correct', 'moderate', 'incorrect'];
const FLEXIBILITY_LEVELS = ['low', 'medium', 'high'];
const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'];
const MAX_KEYPOINT_DISTANCE = Math.sqrt(2);

const KEYPOINT_INDEX = {
	leftShoulder: 5,
	rightShoulder: 6,
	leftElbow: 7,
	rightElbow: 8,
	leftWrist: 9,
	rightWrist: 10,
	leftHip: 11,
	rightHip: 12,
	leftKnee: 13,
	rightKnee: 14,
	leftAnkle: 15,
	rightAnkle: 16,
};

const DEFAULT_IDEAL_STEP_ANGLES_DEGREES = {
	step1: [165, 165, 140, 140, 175, 175, 170, 5],
	step2: [150, 150, 125, 125, 165, 165, 155, 15],
	step3: [175, 175, 155, 155, 178, 178, 176, 3],
};

// Fixed angle index order across dataset/training/prediction/reporting:
// 0 left_elbow, 1 right_elbow, 2 left_shoulder, 3 right_shoulder,
// 4 left_knee, 5 right_knee, 6 hip, 7 spine
const JOINT_ANGLE_ORDER = [
	'left_elbow',
	'right_elbow',
	'left_shoulder',
	'right_shoulder',
	'left_knee',
	'right_knee',
	'hip',
	'spine',
];

const STEP_TEMPORAL_CONFIG = {
	WINDOW_SIZE: 5,
	HISTORY_LIMIT: 24,
};

const STEP_CALIBRATION_CONFIG = {
	STEP2_SHOULDER_HARD_THRESHOLD: 0.45,
	STEP2_SPINE_MAX_FOR_ARM_RULE: 24,
	STEP2_HIP_MIN_FOR_ARM_RULE: 148,
	STEP2_STRONG_BIAS: 0.34,
	STEP2_STEP1_PENALTY: 0.16,
	STEP2_STEP3_PENALTY: 0.12,
	STEP2_SHOULDER_SOFT_THRESHOLD: 0.26,
	STEP1_SHOULDER_UPPER_BOUND: 0.15,
	STEP_SCORE_GAP_UNCERTAIN_THRESHOLD: 0.1,
	STEP2_PROMOTION_CONFIDENCE_MIN: 0.58,
	STEP2_PROMOTION_SHOULDER_MIN: 0.45,
	STEP3_PROMOTION_CONFIDENCE_MIN: 0.56,
	STEP3_PROMOTION_SPINE_MIN: 28,
	STEP3_PROMOTION_HIP_MAX: 150,
};

const STEP_DEFINITIONS = {
	step1: {
		ranges: {
			spine: { min: 0, max: 18, softMargin: 14 },
			shoulder: { min: -0.08, max: 0.24, softMargin: 0.34 },
			hip: { min: 145, max: 180, softMargin: 24 },
			elbow: { min: 132, max: 180, softMargin: 28 },
			symmetry: { min: 0.38, max: 1, softMargin: 0.28 },
		},
		weights: {
			spine: 0.4,
			shoulder: 0.45,
			hip: 0.11,
			elbow: 0.02,
			symmetry: 0.02,
		},
	},
	step2: {
		ranges: {
			spine: { min: 0, max: 24, softMargin: 14 },
			shoulder: { min: 0.2, max: 0.95, softMargin: 0.42 },
			hip: { min: 146, max: 176, softMargin: 22 },
			elbow: { min: 122, max: 180, softMargin: 30 },
			symmetry: { min: 0.28, max: 1, softMargin: 0.3 },
		},
		weights: {
			spine: 0.35,
			shoulder: 0.5,
			hip: 0.11,
			elbow: 0.02,
			symmetry: 0.02,
		},
	},
	step3: {
		ranges: {
			spine: { min: 30, max: 75, softMargin: 20 },
			shoulder: { min: 0.35, max: 1.25, softMargin: 0.45 },
			hip: { min: 108, max: 166, softMargin: 26 },
			elbow: { min: 112, max: 180, softMargin: 36 },
			symmetry: { min: 0.2, max: 1, softMargin: 0.33 },
		},
		weights: {
			spine: 0.43,
			shoulder: 0.27,
			hip: 0.24,
			elbow: 0.05,
			symmetry: 0.05,
		},
	},
};

function toOneHot(value, ordered) {
	return ordered.map((item) => (item === value ? 1 : 0));
}

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

function getPointFromFeatures(featureArray, keypointIndex) {
	if (!Array.isArray(featureArray) || featureArray.length < ((keypointIndex * 2) + 2)) {
		return null;
	}

	const x = featureArray[keypointIndex * 2];
	const y = featureArray[(keypointIndex * 2) + 1];
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}

	return { x, y };
}

function distanceBetweenPoints(a, b) {
	if (!a || !b) {
		return 0;
	}

	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return Math.sqrt((dx * dx) + (dy * dy));
}

function midpoint(a, b) {
	if (!a || !b) {
		return null;
	}

	return {
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
	};
}

function computeAngleDegrees(a, b, c) {
	if (!a || !b || !c) {
		return 0;
	}

	const abx = a.x - b.x;
	const aby = a.y - b.y;
	const cbx = c.x - b.x;
	const cby = c.y - b.y;
	const dot = (abx * cbx) + (aby * cby);
	const magAB = Math.sqrt((abx * abx) + (aby * aby));
	const magCB = Math.sqrt((cbx * cbx) + (cby * cby));

	if (magAB === 0 || magCB === 0) {
		return 0;
	}

	const cosine = clamp(dot / (magAB * magCB), -1, 1);
	return Math.acos(cosine) * (180 / Math.PI);
}

function normalizeAngleDegrees(angle) {
	return clamp((Number(angle) || 0) / 180, 0, 1);
}

function extractJointAnglesDegrees(keypointFeatures) {
	const ls = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftShoulder);
	const rs = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightShoulder);
	const le = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftElbow);
	const re = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightElbow);
	const lw = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftWrist);
	const rw = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightWrist);
	const lh = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftHip);
	const rh = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightHip);
	const lk = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftKnee);
	const rk = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightKnee);
	const la = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftAnkle);
	const ra = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightAnkle);
	const shoulderMid = midpoint(ls, rs);
	const hipMid = midpoint(lh, rh);
	const kneeMid = midpoint(lk, rk);
	const spineReference = hipMid ? { x: hipMid.x, y: hipMid.y + 1 } : null;

	return [
		computeAngleDegrees(ls, le, lw),
		computeAngleDegrees(rs, re, rw),
		computeAngleDegrees(le, ls, lh),
		computeAngleDegrees(re, rs, rh),
		computeAngleDegrees(lh, lk, la),
		computeAngleDegrees(rh, rk, ra),
		computeAngleDegrees(shoulderMid, hipMid, kneeMid),
		computeAngleDegrees(shoulderMid, hipMid, spineReference),
	];
}

function buildAngleDifferenceFeatures(idealAngles, jointAnglesDegrees) {
	const safeIdealAngles = Array.isArray(idealAngles) && idealAngles.length === 8
		? idealAngles
		: new Array(8).fill(0);
	return jointAnglesDegrees.map((angle, index) => normalizeAngleDegrees(Math.abs((Number(angle) || 0) - (Number(safeIdealAngles[index]) || 0))));
}

function computeMovementFeature(currentKeypointFeatures, previousKeypointFeatures) {
	if (!Array.isArray(previousKeypointFeatures) || previousKeypointFeatures.length !== 34) {
		return 0;
	}

	let totalDistance = 0;
	let count = 0;
	for (let i = 0; i < 17; i += 1) {
		const currentPoint = getPointFromFeatures(currentKeypointFeatures, i);
		const previousPoint = getPointFromFeatures(previousKeypointFeatures, i);
		if (!currentPoint || !previousPoint) {
			continue;
		}
		totalDistance += distanceBetweenPoints(currentPoint, previousPoint);
		count += 1;
	}

	if (count === 0) {
		return 0;
	}

	return clamp((totalDistance / count) / MAX_KEYPOINT_DISTANCE, 0, 1);
}

function normalizeRatio(value) {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return value / (1 + value);
}

function averageFinite(values, fallback = 0) {
	if (!Array.isArray(values) || !values.length) {
		return fallback;
	}

	const finite = values.filter((value) => Number.isFinite(value));
	if (!finite.length) {
		return fallback;
	}

	return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function computeRangeScore(value, rangeConfig) {
	if (!Number.isFinite(value) || !rangeConfig) {
		return 0;
	}

	const min = Number(rangeConfig.min);
	const max = Number(rangeConfig.max);
	const softMargin = Math.max(0.0001, Number(rangeConfig.softMargin) || 1);

	if (value >= min && value <= max) {
		return 1;
	}

	if (value < min) {
		return clamp(1 - ((min - value) / softMargin), 0, 1);
	}

	return clamp(1 - ((value - max) / softMargin), 0, 1);
}

function computeBiomechanicalStepFeatures(keypointFeatures, jointAnglesDegrees) {
	const ls = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftShoulder);
	const rs = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightShoulder);
	const lw = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftWrist);
	const rw = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightWrist);
	const lh = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftHip);
	const rh = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightHip);
	const lk = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftKnee);
	const rk = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightKnee);

	const shoulderMid = midpoint(ls, rs);
	const hipMid = midpoint(lh, rh);
	const leftHipAngle = computeAngleDegrees(ls, lh, lk);
	const rightHipAngle = computeAngleDegrees(rs, rh, rk);
	const leftElbowAngle = computeAngleDegrees(ls, getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftElbow), lw);
	const rightElbowAngle = computeAngleDegrees(rs, getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightElbow), rw);

	const torsoLength = Math.max(0.001, distanceBetweenPoints(shoulderMid, hipMid));
	const leftArmLift = torsoLength > 0 && ls && lw ? (ls.y - lw.y) / torsoLength : 0;
	const rightArmLift = torsoLength > 0 && rs && rw ? (rs.y - rw.y) / torsoLength : 0;
	const maxArmLift = Math.max(leftArmLift, rightArmLift);

	const dx = shoulderMid && hipMid ? shoulderMid.x - hipMid.x : 0;
	const dy = shoulderMid && hipMid ? shoulderMid.y - hipMid.y : 1;
	const spineTiltDegrees = Math.abs(Math.atan2(Math.abs(dx), Math.max(0.0001, Math.abs(dy))) * (180 / Math.PI));

	const shoulderAngles = [Number(jointAnglesDegrees?.[2]), Number(jointAnglesDegrees?.[3])];
	const elbowAngles = [
		Number.isFinite(leftElbowAngle) ? leftElbowAngle : Number(jointAnglesDegrees?.[0]),
		Number.isFinite(rightElbowAngle) ? rightElbowAngle : Number(jointAnglesDegrees?.[1]),
	];
	const hipAngles = [leftHipAngle, rightHipAngle];

	const shoulderDiff = Math.abs((Number.isFinite(shoulderAngles[0]) ? shoulderAngles[0] : 0) - (Number.isFinite(shoulderAngles[1]) ? shoulderAngles[1] : 0));
	const elbowDiff = Math.abs((Number.isFinite(elbowAngles[0]) ? elbowAngles[0] : 0) - (Number.isFinite(elbowAngles[1]) ? elbowAngles[1] : 0));
	const hipDiff = Math.abs((Number.isFinite(hipAngles[0]) ? hipAngles[0] : 0) - (Number.isFinite(hipAngles[1]) ? hipAngles[1] : 0));
	const symmetryPenalty = averageFinite([shoulderDiff / 180, elbowDiff / 180, hipDiff / 180], 1);

	return {
		spine: clamp(spineTiltDegrees, 0, 90),
		shoulder: clamp(maxArmLift, -0.5, 1.6),
		hip: clamp(averageFinite(hipAngles, Number(jointAnglesDegrees?.[6]) || 0), 0, 180),
		elbow: clamp(averageFinite(elbowAngles, 0), 0, 180),
		symmetry: clamp(1 - symmetryPenalty, 0, 1),
	};
}

function computeStepScoresFromFeatures(featureVector) {
	const stepScores = {};

	for (const stepKey of ['step1', 'step2', 'step3']) {
		const definition = STEP_DEFINITIONS[stepKey];
		const weights = definition.weights;
		const ranges = definition.ranges;

		const spineScore = computeRangeScore(featureVector.spine, ranges.spine);
		const shoulderScore = computeRangeScore(featureVector.shoulder, ranges.shoulder);
		const hipScore = computeRangeScore(featureVector.hip, ranges.hip);
		const elbowScore = computeRangeScore(featureVector.elbow, ranges.elbow);
		const symmetryScore = computeRangeScore(featureVector.symmetry, ranges.symmetry);

		stepScores[stepKey] =
			(spineScore * weights.spine) +
			(shoulderScore * weights.shoulder) +
			(hipScore * weights.hip) +
			(elbowScore * weights.elbow) +
			(symmetryScore * weights.symmetry);
	}

	// Biomechanical disambiguation rules:
	// STEP2 is defined by raised arm with non-high spine tilt.
	if (
		featureVector.shoulder >= STEP_CALIBRATION_CONFIG.STEP2_SHOULDER_HARD_THRESHOLD &&
		featureVector.spine < STEP_CALIBRATION_CONFIG.STEP2_SPINE_MAX_FOR_ARM_RULE &&
		featureVector.hip >= STEP_CALIBRATION_CONFIG.STEP2_HIP_MIN_FOR_ARM_RULE
	) {
		stepScores.step2 += STEP_CALIBRATION_CONFIG.STEP2_STRONG_BIAS;
		stepScores.step1 -= STEP_CALIBRATION_CONFIG.STEP2_STEP1_PENALTY;
		stepScores.step3 -= STEP_CALIBRATION_CONFIG.STEP2_STEP3_PENALTY;
	} else if (
		featureVector.shoulder >= STEP_CALIBRATION_CONFIG.STEP2_SHOULDER_SOFT_THRESHOLD &&
		featureVector.spine < STEP_CALIBRATION_CONFIG.STEP2_SPINE_MAX_FOR_ARM_RULE
	) {
		stepScores.step2 += STEP_CALIBRATION_CONFIG.STEP2_STRONG_BIAS * 0.5;
	}

	// STEP3 should require distinctly high side bend or deeper hip deviation.
	if (featureVector.spine >= 30 || featureVector.hip <= 145) {
		stepScores.step3 += 0.15;
	}

	// STEP1 should remain low-tilt with non-raised arm.
	if (
		featureVector.shoulder < STEP_CALIBRATION_CONFIG.STEP1_SHOULDER_UPPER_BOUND &&
		featureVector.spine < 16
	) {
		stepScores.step1 += 0.12;
	}

	for (const stepKey of ['step1', 'step2', 'step3']) {
		stepScores[stepKey] = Math.max(0, Number(stepScores[stepKey]) || 0);
	}

	return stepScores;
}

function computeBodyRatioFeatures(keypointFeatures) {
	const ls = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftShoulder);
	const rs = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightShoulder);
	const le = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftElbow);
	const re = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightElbow);
	const lw = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftWrist);
	const rw = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightWrist);
	const lh = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftHip);
	const rh = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightHip);
	const lk = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftKnee);
	const rk = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightKnee);
	const la = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.leftAnkle);
	const ra = getPointFromFeatures(keypointFeatures, KEYPOINT_INDEX.rightAnkle);

	const shoulderMid = midpoint(ls, rs);
	const hipMid = midpoint(lh, rh);

	const shoulderWidth = distanceBetweenPoints(ls, rs);
	const hipWidth = distanceBetweenPoints(lh, rh);
	const torsoLength = distanceBetweenPoints(shoulderMid, hipMid);

	const leftArmLength = distanceBetweenPoints(ls, le) + distanceBetweenPoints(le, lw);
	const rightArmLength = distanceBetweenPoints(rs, re) + distanceBetweenPoints(re, rw);
	const armLength = (leftArmLength + rightArmLength) / 2;

	const leftLegLength = distanceBetweenPoints(lh, lk) + distanceBetweenPoints(lk, la);
	const rightLegLength = distanceBetweenPoints(rh, rk) + distanceBetweenPoints(rk, ra);
	const legLength = (leftLegLength + rightLegLength) / 2;

	const shoulderHipRatio = hipWidth > 0 ? shoulderWidth / hipWidth : 0;
	const armTorsoRatio = torsoLength > 0 ? armLength / torsoLength : 0;
	const legTorsoRatio = torsoLength > 0 ? legLength / torsoLength : 0;

	return [
		normalizeRatio(shoulderHipRatio),
		normalizeRatio(armTorsoRatio),
		normalizeRatio(legTorsoRatio),
	];
}

function detectCurrentStep({ keypointFeatures, jointAnglesDegrees }) {
	const stepFeatureVector = computeBiomechanicalStepFeatures(keypointFeatures, jointAnglesDegrees);
	const stepScores = computeStepScoresFromFeatures(stepFeatureVector);
	const sorted = Object.entries(stepScores).sort((left, right) => right[1] - left[1]);
	const rawStep = sorted[0]?.[0] || 'step1';
	const scoreSum = sorted.reduce((sum, item) => sum + (Number(item[1]) || 0), 0);
	const rawStepConfidence = scoreSum > 0 ? clamp((Number(stepScores[rawStep]) || 0) / scoreSum, 0, 1) : 0;

	return {
		rawStep,
		rawStepConfidence,
		stepScores,
		stepFeatureVector,
	};
}

export class PredictionEngine {
	constructor(modelBasePath = '/models') {
		this.modelBasePath = modelBasePath;
		this.idealPoseDataPath = '/ideal_pose_data.json';
		this.models = {
			step1: null,
			step2: null,
			step3: null,
		};
		this.idealStepAngles = { ...DEFAULT_IDEAL_STEP_ANGLES_DEGREES };
		this.previousKeypointFeatures = null;
		this.recentStepPredictions = [];
		this.smoothedStepHistory = [];
	}

	buildWindowWeightedStepCounts(windowEntries) {
		const counts = {
			step1: 0,
			step2: 0,
			step3: 0,
		};

		for (const item of windowEntries) {
			if (!item || !counts.hasOwnProperty(item.step)) {
				continue;
			}
			const confidence = clamp(Number(item.confidence) || 0, 0, 1);
			const weight = 0.55 + (confidence * 0.45);
			counts[item.step] += weight;
		}

		return counts;
	}

	enforceTransitionConstraints(candidateStep, windowEntries, currentFeatures = null, rawContext = null) {
		const lastSmoothed = this.smoothedStepHistory.length
			? this.smoothedStepHistory[this.smoothedStepHistory.length - 1]
			: null;

		if (!lastSmoothed) {
			return candidateStep;
		}

		if (lastSmoothed === 'step1' && candidateStep === 'step3') {
			return 'step2';
		}

		if (lastSmoothed === 'step2' && candidateStep === 'step1') {
			const sustainedStep1Votes = windowEntries.filter((item) => item?.step === 'step1').length;
			return sustainedStep1Votes >= Math.max(4, windowEntries.length) ? 'step1' : 'step2';
		}

		if (lastSmoothed === 'step2' && candidateStep === 'step3') {
			const step3Votes = windowEntries.filter((item) => item?.step === 'step3').length;
			const rawStep = rawContext?.rawStep;
			const rawConfidence = Number(rawContext?.rawConfidence) || 0;
			const hasStep3Geometry = Number(currentFeatures?.spine) >= 24 || Number(currentFeatures?.hip) <= 156;
			const strongStep3Signal =
				rawStep === 'step3' &&
				rawConfidence >= STEP_CALIBRATION_CONFIG.STEP3_PROMOTION_CONFIDENCE_MIN &&
				(Number(currentFeatures?.spine) >= STEP_CALIBRATION_CONFIG.STEP3_PROMOTION_SPINE_MIN || Number(currentFeatures?.hip) <= STEP_CALIBRATION_CONFIG.STEP3_PROMOTION_HIP_MAX);
			return (step3Votes >= 2 && hasStep3Geometry) || strongStep3Signal ? 'step3' : 'step2';
		}

		if (lastSmoothed === 'step3' && candidateStep !== 'step3') {
			const keepStep3Votes = windowEntries.filter((item) => item?.step === 'step3').length;
			return keepStep3Votes >= 2 ? 'step3' : 'step2';
		}

		return candidateStep;
	}

	applyTemporalStepSmoothing(rawStep, rawStepConfidence, stepScores, stepFeatureVector = null) {
		const safeConfidence = clamp(Number(rawStepConfidence) || 0, 0, 1);
		const candidateEntry = {
			step: rawStep,
			confidence: safeConfidence,
			timestamp: Date.now(),
		};

		const rawWindow = [...this.recentStepPredictions.slice(-(STEP_TEMPORAL_CONFIG.WINDOW_SIZE - 1)), candidateEntry];
		const weightedCounts = this.buildWindowWeightedStepCounts(rawWindow);
		const ranked = Object.entries(weightedCounts).sort((left, right) => right[1] - left[1]);
		let candidateStep = ranked[0]?.[0] || rawStep;
		candidateStep = this.enforceTransitionConstraints(candidateStep, rawWindow, stepFeatureVector, {
			rawStep,
			rawConfidence: safeConfidence,
		});

		const lastSmoothed = this.smoothedStepHistory.length
			? this.smoothedStepHistory[this.smoothedStepHistory.length - 1]
			: null;
		const shouldPromoteToStep2 =
			lastSmoothed === 'step1' &&
			rawStep === 'step2' &&
			safeConfidence >= STEP_CALIBRATION_CONFIG.STEP2_PROMOTION_CONFIDENCE_MIN &&
			Number(stepFeatureVector?.shoulder) >= STEP_CALIBRATION_CONFIG.STEP2_PROMOTION_SHOULDER_MIN &&
			Number(stepFeatureVector?.spine) < STEP_CALIBRATION_CONFIG.STEP2_SPINE_MAX_FOR_ARM_RULE;
		if (shouldPromoteToStep2) {
			candidateStep = 'step2';
		}

		const shouldPromoteToStep3 =
			rawStep === 'step3' &&
			safeConfidence >= STEP_CALIBRATION_CONFIG.STEP3_PROMOTION_CONFIDENCE_MIN &&
			(Number(stepFeatureVector?.spine) >= STEP_CALIBRATION_CONFIG.STEP3_PROMOTION_SPINE_MIN || Number(stepFeatureVector?.hip) <= STEP_CALIBRATION_CONFIG.STEP3_PROMOTION_HIP_MAX);
		if (shouldPromoteToStep3) {
			candidateStep = 'step3';
		}

		const scoreRanking = Object.entries(stepScores || {}).sort((left, right) => (Number(right[1]) || 0) - (Number(left[1]) || 0));
		const topScore = Number(scoreRanking[0]?.[1]) || 0;
		const secondScore = Number(scoreRanking[1]?.[1]) || 0;
		const scoreGap = Math.max(0, topScore - secondScore);
		const uncertain = scoreGap < STEP_CALIBRATION_CONFIG.STEP_SCORE_GAP_UNCERTAIN_THRESHOLD;

		const sameStepCount = rawWindow.filter((item) => item?.step === candidateStep).length;
		const temporalSupport = rawWindow.length ? sameStepCount / rawWindow.length : 0;
		let stepConfidence = clamp((safeConfidence * 0.7) + (temporalSupport * 0.3), 0, 1);
		if (lastSmoothed && lastSmoothed === candidateStep) {
			stepConfidence = clamp(stepConfidence + 0.08, 0, 1);
		}

		if (lastSmoothed && candidateStep !== lastSmoothed && temporalSupport < 0.4 && !shouldPromoteToStep2 && !shouldPromoteToStep3) {
			candidateStep = lastSmoothed;
			stepConfidence = clamp(stepConfidence * 0.9, 0, 1);
		}

		if (uncertain && lastSmoothed) {
			candidateStep = this.enforceTransitionConstraints(lastSmoothed, rawWindow, stepFeatureVector);
			stepConfidence = clamp(stepConfidence * 0.88, 0, 1);
		}

		this.recentStepPredictions.push(candidateEntry);
		if (this.recentStepPredictions.length > STEP_TEMPORAL_CONFIG.HISTORY_LIMIT) {
			this.recentStepPredictions = this.recentStepPredictions.slice(-STEP_TEMPORAL_CONFIG.HISTORY_LIMIT);
		}

		this.smoothedStepHistory.push(candidateStep);
		if (this.smoothedStepHistory.length > STEP_TEMPORAL_CONFIG.HISTORY_LIMIT) {
			this.smoothedStepHistory = this.smoothedStepHistory.slice(-STEP_TEMPORAL_CONFIG.HISTORY_LIMIT);
		}

		return {
			smoothedStep: candidateStep,
			stepConfidence,
			temporalSupport,
			uncertain,
			scoreGap,
			windowSteps: rawWindow.map((item) => item.step),
			stepScores,
		};
	}

	async loadIdealPoseData() {
		try {
			const response = await fetch(this.idealPoseDataPath, { cache: 'no-store' });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const payload = await response.json();
			for (const stepKey of ['step1', 'step2', 'step3']) {
				const candidate = payload?.[stepKey]?.idealAngles;
				if (Array.isArray(candidate) && candidate.length === 8) {
					this.idealStepAngles[stepKey] = candidate.map((item) => Number(item) || 0);
				}
			}
		} catch (error) {
			console.warn(`Could not load ${this.idealPoseDataPath}, using fallback ideal angles.`, error);
		}
	}

	async load() {
		if (this.models.step1 && this.models.step2 && this.models.step3) {
			return this.models;
		}

		const [, step1Model, step2Model, step3Model] = await Promise.all([
			this.loadIdealPoseData().then(() => null),
			window.tf.loadLayersModel(`${this.modelBasePath}/step1_model/model.json`),
			window.tf.loadLayersModel(`${this.modelBasePath}/step2_model/model.json`),
			window.tf.loadLayersModel(`${this.modelBasePath}/step3_model/model.json`),
		]);

		this.models.step1 = step1Model;
		this.models.step2 = step2Model;
		this.models.step3 = step3Model;
		return this.models;
	}

	buildInputVector({ keypointFeatures, userProfile, movementFeature, jointAngleFeatures, bodyRatioFeatures, angleDifferenceFeatures }) {
		const age = clamp(Number(userProfile.age) || 30, 20, 60);
		const normalizedAge = clamp(age / 60, 0, 1);
		const flexibility = toOneHot(userProfile.flexibility, FLEXIBILITY_LEVELS);
		const experience = toOneHot(userProfile.experience, EXPERIENCE_LEVELS);

		return [
			...keypointFeatures,
			...jointAngleFeatures,
			...angleDifferenceFeatures,
			movementFeature,
			...bodyRatioFeatures,
			normalizedAge,
			...flexibility,
			...experience,
		];
	}

	predictStepOnly(keypointFeatures) {
		const jointAnglesDegrees = extractJointAnglesDegrees(keypointFeatures);
		const stepDetection = detectCurrentStep({
			keypointFeatures,
			jointAnglesDegrees,
		});
		const temporalStep = this.applyTemporalStepSmoothing(
			stepDetection.rawStep,
			stepDetection.rawStepConfidence,
			stepDetection.stepScores,
			stepDetection.stepFeatureVector,
		);

		return {
			rawStep: stepDetection.rawStep,
			smoothedStep: temporalStep.smoothedStep,
			stepConfidence: temporalStep.stepConfidence,
			temporalSupport: temporalStep.temporalSupport,
			uncertain: temporalStep.uncertain,
			scoreGap: temporalStep.scoreGap,
			stepScores: temporalStep.stepScores,
			stepFeatureVector: stepDetection.stepFeatureVector,
			jointAnglesDegrees,
		};
	}

	async predict(keypointFeatures, userProfile, rawKeypointFeatures = null) {
		if (!this.models.step1 || !this.models.step2 || !this.models.step3) {
			await this.load();
		}

		const movementFeature = computeMovementFeature(keypointFeatures, this.previousKeypointFeatures);
		const jointAnglesDegrees = extractJointAnglesDegrees(keypointFeatures);
		const jointAngleFeatures = jointAnglesDegrees.map((angle) => normalizeAngleDegrees(angle));
		const bodyRatioFeatures = computeBodyRatioFeatures(keypointFeatures);
		const angleDifferenceByStep = {
			step1: buildAngleDifferenceFeatures(this.idealStepAngles.step1, jointAnglesDegrees),
			step2: buildAngleDifferenceFeatures(this.idealStepAngles.step2, jointAnglesDegrees),
			step3: buildAngleDifferenceFeatures(this.idealStepAngles.step3, jointAnglesDegrees),
		};

		const stepDetection = detectCurrentStep({
			keypointFeatures,
			jointAnglesDegrees,
		});
		const temporalStep = this.applyTemporalStepSmoothing(
			stepDetection.rawStep,
			stepDetection.rawStepConfidence,
			stepDetection.stepScores,
			stepDetection.stepFeatureVector,
		);
		const stepKey = temporalStep.smoothedStep;

		const angleDifferenceFeatures = angleDifferenceByStep[stepKey] || angleDifferenceByStep[stepDetection.rawStep] || angleDifferenceByStep.step1;
		const inputVector = this.buildInputVector({
			keypointFeatures,
			userProfile,
			movementFeature,
			jointAngleFeatures,
			bodyRatioFeatures,
			angleDifferenceFeatures,
		});

		if (inputVector.length !== 61) {
			throw new Error(`Invalid feature length ${inputVector.length}, expected 61.`);
		}

		const model = this.models[stepKey] || this.models.step1;
		const tensor = window.tf.tensor2d([inputVector], [1, 61], 'float32');
		const predTensor = model.predict(tensor);
		const probs = await predTensor.data();
		tensor.dispose();
		predTensor.dispose();
		this.previousKeypointFeatures = Array.isArray(keypointFeatures) ? [...keypointFeatures] : null;

		let bestIndex = 0;
		for (let i = 1; i < probs.length; i += 1) {
			if (probs[i] > probs[bestIndex]) {
				bestIndex = i;
			}
		}

		return {
			step: stepKey,
			rawStep: stepDetection.rawStep,
			smoothedStep: stepKey,
			stepConfidence: temporalStep.stepConfidence,
			temporalSupport: temporalStep.temporalSupport,
			uncertain: temporalStep.uncertain,
			scoreGap: temporalStep.scoreGap,
			stepScores: temporalStep.stepScores,
			stepWindow: temporalStep.windowSteps,
			stepFeatureVector: stepDetection.stepFeatureVector,
			label: LABELS[bestIndex],
			classIndex: bestIndex,
			confidence: probs[bestIndex],
			probabilities: Array.from(probs),
			inputVector,
			movementFeature,
			jointAnglesDegrees,
			jointAngleFeatures,
			angleDifferenceFeatures,
			rawKeypointFeatures: Array.isArray(rawKeypointFeatures) ? [...rawKeypointFeatures] : null,
			jointAngleOrder: JOINT_ANGLE_ORDER,
			bodyRatioFeatures,
			timestamp: Date.now(),
		};
	}
}

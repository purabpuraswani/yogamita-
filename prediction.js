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

function detectCurrentStep({ movementFeature, jointAngleFeatures, angleDifferenceByStep }) {
	const avgAngleDiff = (stepKey) => {
		const values = angleDifferenceByStep[stepKey] || [];
		if (!values.length) {
			return 1;
		}
		return values.reduce((sum, item) => sum + item, 0) / values.length;
	};

	const diffStep1 = avgAngleDiff('step1');
	const diffStep2 = avgAngleDiff('step2');
	const diffStep3 = avgAngleDiff('step3');
	const meanKnee = ((jointAngleFeatures[4] || 0) + (jointAngleFeatures[5] || 0)) / 2;

	if (movementFeature >= 0.03) {
		return 'step2';
	}

	if (diffStep3 <= diffStep1 && meanKnee >= 0.94) {
		return 'step3';
	}

	if (diffStep2 < Math.min(diffStep1, diffStep3)) {
		return 'step2';
	}

	return diffStep1 <= diffStep3 ? 'step1' : 'step3';
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

	async predict(keypointFeatures, userProfile) {
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

		const stepKey = detectCurrentStep({
			movementFeature,
			jointAngleFeatures,
			angleDifferenceByStep,
		});

		const angleDifferenceFeatures = angleDifferenceByStep[stepKey];
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
			label: LABELS[bestIndex],
			classIndex: bestIndex,
			confidence: probs[bestIndex],
			probabilities: Array.from(probs),
			inputVector,
			movementFeature,
			jointAnglesDegrees,
			jointAngleFeatures,
			angleDifferenceFeatures,
			jointAngleOrder: JOINT_ANGLE_ORDER,
			bodyRatioFeatures,
			timestamp: Date.now(),
		};
	}
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const tf = require('@tensorflow/tfjs');
const poseDetection = require('@tensorflow-models/pose-detection');
const sharp = require('sharp');

const ROOT_DIR = process.cwd();
const VIDEO_CANDIDATES = [
	path.join(ROOT_DIR, 'videos', 'instructor', 'konasana.mp4'),
	path.join(ROOT_DIR, 'videos', 'instructor', 'konasana vedio.mp4'),
];
const PUBLIC_IDEAL_POSE_DATA_PATH = path.join(ROOT_DIR, 'public', 'ideal_pose_data.json');
const IDEAL_POSE_DATA_PATH = path.join(ROOT_DIR, 'ideal_pose_data.json');
const SAMPLE_FPS = 5;

const STEP_KEYS = ['step1', 'step2', 'step3'];
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

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

function toOneHot(value, classes) {
	return classes.map((item) => (item === value ? 1 : 0));
}

function getPointFromFeatures(featureArray, keypointIndex) {
	if (!Array.isArray(featureArray) || featureArray.length < ((keypointIndex * 2) + 2)) {
		return null;
	}

	const x = Number(featureArray[keypointIndex * 2]);
	const y = Number(featureArray[(keypointIndex * 2) + 1]);
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
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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

function extractNormalizedKeypoints(pose, imageWidth, imageHeight) {
	const features = [];
	const safeWidth = imageWidth > 0 ? imageWidth : 1;
	const safeHeight = imageHeight > 0 ? imageHeight : 1;

	if (!pose || !Array.isArray(pose.keypoints) || pose.keypoints.length < 17) {
		return new Array(34).fill(0);
	}

	for (let i = 0; i < 17; i += 1) {
		const kp = pose.keypoints[i];
		const x = Number.isFinite(kp?.x) ? clamp(kp.x / safeWidth, 0, 1) : 0;
		const y = Number.isFinite(kp?.y) ? clamp(kp.y / safeHeight, 0, 1) : 0;
		features.push(x, y);
	}

	return features;
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
		const current = getPointFromFeatures(currentKeypointFeatures, i);
		const previous = getPointFromFeatures(previousKeypointFeatures, i);
		if (!current || !previous) {
			continue;
		}
		totalDistance += distanceBetweenPoints(current, previous);
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

	return [
		normalizeRatio(hipWidth > 0 ? shoulderWidth / hipWidth : 0),
		normalizeRatio(torsoLength > 0 ? armLength / torsoLength : 0),
		normalizeRatio(torsoLength > 0 ? legLength / torsoLength : 0),
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

function resolveVideoPath() {
	for (const candidate of VIDEO_CANDIDATES) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(
		`Instructor video not found. Checked:\n${VIDEO_CANDIDATES.map((item) => `- ${item}`).join('\n')}`
	);
}

function ensureFfmpegAvailable() {
	try {
		execSync('ffmpeg -version', { stdio: 'ignore' });
	} catch (error) {
		throw new Error('ffmpeg is required but not found in PATH. Install ffmpeg and try again.');
	}
}

function extractFrames(videoPath, framesDir) {
	fs.mkdirSync(framesDir, { recursive: true });
	const framePattern = path.join(framesDir, 'frame_%06d.jpg');
	const cmd = `ffmpeg -hide_banner -loglevel error -i "${videoPath}" -vf "fps=${SAMPLE_FPS}" -q:v 2 "${framePattern}" -y`;
	execSync(cmd, { stdio: 'inherit' });

	const frameFiles = fs
		.readdirSync(framesDir)
		.filter((name) => name.toLowerCase().endsWith('.jpg'))
		.sort();

	if (!frameFiles.length) {
		throw new Error('No frames were extracted from instructor video.');
	}

	return frameFiles.map((name, index) => ({
		path: path.join(framesDir, name),
		timestamp: index / SAMPLE_FPS,
	}));
}

async function imageFileToTensor(imagePath) {
	const { data, info } = await sharp(imagePath)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	return {
		tensor: tf.tensor3d(pixels, [info.height, info.width, info.channels], 'int32'),
		width: info.width,
		height: info.height,
	};
}

function loadIdealAngles() {
	const sourcePath = fs.existsSync(PUBLIC_IDEAL_POSE_DATA_PATH)
		? PUBLIC_IDEAL_POSE_DATA_PATH
		: IDEAL_POSE_DATA_PATH;

	if (!fs.existsSync(sourcePath)) {
		return {
			step1: [165, 165, 140, 140, 175, 175, 170, 5],
			step2: [150, 150, 125, 125, 165, 165, 155, 15],
			step3: [175, 175, 155, 155, 178, 178, 176, 3],
		};
	}

	const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
	const result = {};
	for (const stepKey of STEP_KEYS) {
		const candidate = payload?.[stepKey]?.idealAngles;
		result[stepKey] = Array.isArray(candidate) && candidate.length === 8
			? candidate.map((item) => Number(item) || 0)
			: [0, 0, 0, 0, 0, 0, 0, 0];
	}
	return result;
}

function buildFeatureVector({ keypointFeatures, jointAngleFeatures, angleDifferenceFeatures, movementFeature, bodyRatioFeatures }) {
	const normalizedAge = clamp(30 / 60, 0, 1);
	const flexibility = toOneHot('medium', FLEXIBILITY_LEVELS);
	const experience = toOneHot('intermediate', EXPERIENCE_LEVELS);

	const fullFeatures = [
		...keypointFeatures,
		...jointAngleFeatures,
		...angleDifferenceFeatures,
		movementFeature,
		...bodyRatioFeatures,
		normalizedAge,
		...flexibility,
		...experience,
	];

	if (fullFeatures.length !== 61) {
		throw new Error(`Invalid feature vector length ${fullFeatures.length}, expected 61.`);
	}

	return fullFeatures;
}

function saveIdealTimings(stepFirstTimes) {
	const existing = fs.existsSync(IDEAL_POSE_DATA_PATH)
		? JSON.parse(fs.readFileSync(IDEAL_POSE_DATA_PATH, 'utf-8'))
		: {};

	for (const stepKey of STEP_KEYS) {
		if (!existing[stepKey] || typeof existing[stepKey] !== 'object') {
			existing[stepKey] = {};
		}
		existing[stepKey].idealTime = Number.isFinite(stepFirstTimes[stepKey])
			? Number(stepFirstTimes[stepKey].toFixed(3))
			: null;
	}

	fs.writeFileSync(IDEAL_POSE_DATA_PATH, JSON.stringify(existing, null, 2), 'utf-8');
	if (fs.existsSync(path.dirname(PUBLIC_IDEAL_POSE_DATA_PATH))) {
		fs.writeFileSync(PUBLIC_IDEAL_POSE_DATA_PATH, JSON.stringify(existing, null, 2), 'utf-8');
	}
}

async function main() {
	ensureFfmpegAvailable();

	const videoPath = resolveVideoPath();
	console.log(`Using instructor video: ${videoPath}`);

	await tf.setBackend('cpu');
	await tf.ready();

	const detector = await poseDetection.createDetector(
		poseDetection.SupportedModels.MoveNet,
		{
			runtime: 'tfjs',
			modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
		}
	);

	const tempFramesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yogmitra-ideal-frames-'));
	const frames = extractFrames(videoPath, tempFramesDir);
	const idealAngles = loadIdealAngles();

	const firstStepTimes = {
		step1: null,
		step2: null,
		step3: null,
	};

	let previousKeypointFeatures = null;

	for (const frame of frames) {
		let imageTensor = null;
		try {
			const imageInfo = await imageFileToTensor(frame.path);
			imageTensor = imageInfo.tensor;

			const poses = await detector.estimatePoses(imageTensor);
			if (!poses.length) {
				continue;
			}

			const keypointFeatures = extractNormalizedKeypoints(poses[0], imageInfo.width, imageInfo.height);
			const jointAnglesDegrees = extractJointAnglesDegrees(keypointFeatures);
			const jointAngleFeatures = jointAnglesDegrees.map((angle) => normalizeAngleDegrees(angle));
			const movementFeature = computeMovementFeature(keypointFeatures, previousKeypointFeatures);
			const bodyRatioFeatures = computeBodyRatioFeatures(keypointFeatures);

			const angleDifferenceByStep = {
				step1: buildAngleDifferenceFeatures(idealAngles.step1, jointAnglesDegrees),
				step2: buildAngleDifferenceFeatures(idealAngles.step2, jointAnglesDegrees),
				step3: buildAngleDifferenceFeatures(idealAngles.step3, jointAnglesDegrees),
			};

			const detectedStep = detectCurrentStep({
				movementFeature,
				jointAngleFeatures,
				angleDifferenceByStep,
			});

			buildFeatureVector({
				keypointFeatures,
				jointAngleFeatures,
				angleDifferenceFeatures: angleDifferenceByStep[detectedStep],
				movementFeature,
				bodyRatioFeatures,
			});

			if (firstStepTimes[detectedStep] === null) {
				firstStepTimes[detectedStep] = frame.timestamp;
			}

			previousKeypointFeatures = keypointFeatures;
		} finally {
			if (imageTensor) {
				imageTensor.dispose();
			}
		}

		if (STEP_KEYS.every((stepKey) => firstStepTimes[stepKey] !== null)) {
			break;
		}
	}

	if (typeof detector.dispose === 'function') {
		detector.dispose();
	}
	fs.rmSync(tempFramesDir, { recursive: true, force: true });

	saveIdealTimings(firstStepTimes);

	console.log('Ideal step timings extracted:');
	for (const stepKey of STEP_KEYS) {
		const value = firstStepTimes[stepKey];
		if (value === null) {
			console.log(`${stepKey}: not detected`);
		} else {
			console.log(`${stepKey}: ${value.toFixed(3)}s`);
		}
	}
	console.log(`Saved timings to ${IDEAL_POSE_DATA_PATH}`);
}

main().catch((error) => {
	console.error('Failed to extract ideal step timings:', error);
	process.exitCode = 1;
});

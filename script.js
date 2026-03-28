const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');
const poseDetection = require('@tensorflow-models/pose-detection');
const sharp = require('sharp');

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, 'datasets');

const LABELS = ['correct', 'moderate', 'incorrect'];
const STEP_FOLDERS = ['step1', 'step2', 'step3'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);
const FLEXIBILITY_LEVELS = ['low', 'medium', 'high'];
const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'];
const AUGMENT_ROTATE_DEGREES = 5;
const AUGMENT_BRIGHTNESS = 1.1;
const AUGMENT_ZOOM_FACTOR = 1.1;
const AUGMENT_SHIFT_RATIO = 0.05;
const MAX_KEYPOINT_DISTANCE = Math.sqrt(2);

// Tunable reference angles (degrees) for each step in this pose pipeline.
const IDEAL_STEP_ANGLES_DEGREES = {
	step1: [165, 165, 140, 140, 175, 175, 170, 5],
	step2: [150, 150, 125, 125, 165, 165, 155, 15],
	step3: [175, 175, 155, 155, 178, 178, 176, 3],
};

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

const KEYPOINT_INDEX = {
	nose: 0,
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

function isImageFile(fileName) {
	return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
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

async function imageBufferToTensor(imageBuffer) {
	const { data, info } = await sharp(imageBuffer)
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

async function getImagePathsForLabel(baseDir, label) {
	const folder = path.join(baseDir, label);

	if (!fs.existsSync(folder)) {
		console.warn(`Skipping missing folder: ${folder}`);
		return [];
	}

	const entries = await fs.promises.readdir(folder, { withFileTypes: true });
	const imagePaths = entries
		.filter((entry) => entry.isFile() && isImageFile(entry.name))
		.map((entry) => path.join(folder, entry.name));

	if (imagePaths.length === 0) {
		console.warn(`Skipping empty folder: ${folder}`);
	}

	return imagePaths;
}

function poseToFeatureArray(pose, imageWidth, imageHeight) {
	const features = [];
	const safeWidth = Number.isFinite(imageWidth) && imageWidth > 0 ? imageWidth : 1;
	const safeHeight = Number.isFinite(imageHeight) && imageHeight > 0 ? imageHeight : 1;

	if (!pose || !Array.isArray(pose.keypoints) || pose.keypoints.length < 17) {
		return new Array(34).fill(0);
	}

	for (let i = 0; i < 17; i += 1) {
		const keypoint = pose.keypoints[i];
		const rawX = Number.isFinite(keypoint?.x) ? keypoint.x : 0;
		const rawY = Number.isFinite(keypoint?.y) ? keypoint.y : 0;
		const x = Math.min(Math.max(rawX / safeWidth, 0), 1);
		const y = Math.min(Math.max(rawY / safeHeight, 0), 1);
		features.push(x, y);
	}

	return features;
}

function getPointFromKeypoints(keypoints, index) {
	const point = keypoints?.[index];
	if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		return null;
	}
	return { x: point.x, y: point.y };
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

	const cosine = Math.min(1, Math.max(-1, dot / (magAB * magCB)));
	return Math.acos(cosine) * (180 / Math.PI);
}

function normalizeAngleDegrees(angle) {
	return Math.min(Math.max(angle / 180, 0), 1);
}

function extractJointAnglesDegrees(pose) {
	const keypoints = pose?.keypoints;
	if (!Array.isArray(keypoints) || keypoints.length < 17) {
		return new Array(8).fill(0);
	}

	const ls = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.leftShoulder);
	const rs = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.rightShoulder);
	const le = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.leftElbow);
	const re = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.rightElbow);
	const lw = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.leftWrist);
	const rw = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.rightWrist);
	const lh = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.leftHip);
	const rh = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.rightHip);
	const lk = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.leftKnee);
	const rk = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.rightKnee);
	const la = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.leftAnkle);
	const ra = getPointFromKeypoints(keypoints, KEYPOINT_INDEX.rightAnkle);
	const shoulderMid = midpoint(ls, rs);
	const hipMid = midpoint(lh, rh);
	const kneeMid = midpoint(lk, rk);

	const spineReference = hipMid
		? { x: hipMid.x, y: hipMid.y + 100 }
		: null;

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

function buildAngleDifferenceFeatures(stepName, jointAnglesDegrees) {
	const idealAngles = IDEAL_STEP_ANGLES_DEGREES[stepName] || new Array(8).fill(0);
	return jointAnglesDegrees.map((angle, index) => {
		const idealAngle = Number.isFinite(idealAngles[index]) ? idealAngles[index] : 0;
		const diff = Math.abs((Number.isFinite(angle) ? angle : 0) - idealAngle);
		return normalizeAngleDegrees(diff);
	});
}

function getNormalizedPoint(featureArray, keypointIndex) {
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

function computeMovementFeature(currentKeypointFeatures, previousKeypointFeatures) {
	if (!Array.isArray(previousKeypointFeatures) || previousKeypointFeatures.length !== 34) {
		return 0;
	}

	let totalDistance = 0;
	let count = 0;

	for (let i = 0; i < 17; i += 1) {
		const currentPoint = getNormalizedPoint(currentKeypointFeatures, i);
		const previousPoint = getNormalizedPoint(previousKeypointFeatures, i);
		if (!currentPoint || !previousPoint) {
			continue;
		}
		totalDistance += distanceBetweenPoints(currentPoint, previousPoint);
		count += 1;
	}

	if (count === 0) {
		return 0;
	}

	const avgDistance = totalDistance / count;
	return Math.min(Math.max(avgDistance / MAX_KEYPOINT_DISTANCE, 0), 1);
}

function normalizeRatio(value) {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return value / (1 + value);
}

function computeBodyRatioFeatures(keypointFeatures) {
	const ls = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.leftShoulder);
	const rs = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.rightShoulder);
	const le = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.leftElbow);
	const re = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.rightElbow);
	const lw = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.leftWrist);
	const rw = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.rightWrist);
	const lh = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.leftHip);
	const rh = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.rightHip);
	const lk = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.leftKnee);
	const rk = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.rightKnee);
	const la = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.leftAnkle);
	const ra = getNormalizedPoint(keypointFeatures, KEYPOINT_INDEX.rightAnkle);

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

function randomIntInclusive(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(items) {
	return items[Math.floor(Math.random() * items.length)];
}

function toOneHot(value, orderedClasses) {
	return orderedClasses.map((className) => (className === value ? 1 : 0));
}

function generateIndirectParameters() {
	const age = randomIntInclusive(20, 60);
	const flexibility = pickRandom(FLEXIBILITY_LEVELS);
	const experience = pickRandom(EXPERIENCE_LEVELS);

	return {
		age,
		normalizedAge: Math.min(Math.max(age / 60, 0), 1),
		flexibility,
		experience,
		flexibilityOneHot: toOneHot(flexibility, FLEXIBILITY_LEVELS),
		experienceOneHot: toOneHot(experience, EXPERIENCE_LEVELS),
	};
}

async function createAugmentedBuffers(imagePath) {
	const meta = await sharp(imagePath).metadata();
	const width = meta.width || 0;
	const height = meta.height || 0;

	if (!width || !height) {
		return [];
	}

	const zoomedWidth = Math.max(1, Math.floor(width * AUGMENT_ZOOM_FACTOR));
	const zoomedHeight = Math.max(1, Math.floor(height * AUGMENT_ZOOM_FACTOR));
	const zoomLeft = Math.max(0, Math.floor((zoomedWidth - width) / 2));
	const zoomTop = Math.max(0, Math.floor((zoomedHeight - height) / 2));

	const shiftX = Math.max(1, Math.floor(width * AUGMENT_SHIFT_RATIO));
	const shiftY = Math.max(1, Math.floor(height * AUGMENT_SHIFT_RATIO));

	const shiftedBuffer = await sharp(imagePath)
		.extend({
			top: shiftY,
			left: shiftX,
			right: 0,
			bottom: 0,
			background: { r: 0, g: 0, b: 0 },
		})
		.extract({ left: 0, top: 0, width, height })
		.toBuffer();

	return [
		{ tag: 'flip', buffer: await sharp(imagePath).flop().toBuffer() },
		{ tag: 'rotate_pos', buffer: await sharp(imagePath).rotate(AUGMENT_ROTATE_DEGREES, { background: { r: 0, g: 0, b: 0 } }).toBuffer() },
		{ tag: 'rotate_neg', buffer: await sharp(imagePath).rotate(-AUGMENT_ROTATE_DEGREES, { background: { r: 0, g: 0, b: 0 } }).toBuffer() },
		{ tag: 'brightness', buffer: await sharp(imagePath).modulate({ brightness: AUGMENT_BRIGHTNESS }).toBuffer() },
		{ tag: 'zoom', buffer: await sharp(imagePath).resize(zoomedWidth, zoomedHeight).extract({ left: zoomLeft, top: zoomTop, width, height }).toBuffer() },
		{ tag: 'shift', buffer: shiftedBuffer },
	];
}

function sanitizeName(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '_')
		.replace(/[^a-z0-9_-]/g, '_');
}

function buildOutputFileName(poseName, stepName) {
	return `${sanitizeName(poseName)}_${sanitizeName(stepName)}_dataset.json`;
}

function resolveDatasetStepsDir() {
	const cliArg = process.argv[2];
	const candidates = [
		cliArg ? path.resolve(ROOT_DIR, cliArg) : null,
		path.join(ROOT_DIR, 'dataset_steps'),
		path.join(ROOT_DIR, 'images', 'dataset_steps'),
		path.join(ROOT_DIR, 'images', 'konsasna', 'dataset_steps'),
	].filter(Boolean);

	for (const candidate of candidates) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
			return candidate;
		}
	}

	const displayCandidates = candidates.map((entry) => `- ${entry}`).join('\n');
	throw new Error(
		`dataset_steps directory not found. Checked:\n${displayCandidates}\n` +
		`Pass a custom path as first argument, e.g. node script.js ./dataset_steps`
	);
}

async function buildStepwiseDatasets() {
	await tf.setBackend('cpu');
	await tf.ready();

	const datasetStepsDir = resolveDatasetStepsDir();
	console.log(`Using dataset root: ${datasetStepsDir}`);

	const detector = await poseDetection.createDetector(
		poseDetection.SupportedModels.MoveNet,
		{
			runtime: 'tfjs',
			modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
		}
	);

	const outputDatasets = [];

	const poseEntries = await fs.promises.readdir(datasetStepsDir, { withFileTypes: true });
	const poseDirs = poseEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

	for (const poseName of poseDirs) {
		const poseDir = path.join(datasetStepsDir, poseName);

		for (const stepName of STEP_FOLDERS) {
			const stepDir = path.join(poseDir, stepName);

			if (!fs.existsSync(stepDir)) {
				console.warn(`Skipping missing step folder: ${stepDir}`);
				continue;
			}

			const dataset = [];
			const labelCounts = {
				correct: 0,
				moderate: 0,
				incorrect: 0,
			};

			for (const label of LABELS) {
				const imagePaths = await getImagePathsForLabel(stepDir, label);
				let previousKeypointFeatures = null;
				console.log(
					`Processing ${imagePaths.length} images for pose=${poseName}, step=${stepName}, label=${label}`
				);

				for (const imagePath of imagePaths) {
					const variants = [{ tag: 'original', imagePath }];
					try {
						const augmented = await createAugmentedBuffers(imagePath);
						for (const aug of augmented) {
							variants.push({ tag: aug.tag, imageBuffer: aug.buffer, imagePath });
						}
					} catch (augError) {
						console.error(`Failed to build augmentations for ${imagePath}: ${augError.message}`);
					}

					for (const variant of variants) {
						let imageTensor;
						let width;
						let height;

						try {
							const imageInfo = variant.imageBuffer
								? await imageBufferToTensor(variant.imageBuffer)
								: await imageFileToTensor(variant.imagePath);
							imageTensor = imageInfo.tensor;
							width = imageInfo.width;
							height = imageInfo.height;

							const poses = await detector.estimatePoses(imageTensor);
							const keypointFeatures = poseToFeatureArray(poses[0], width, height);
							const jointAnglesDegrees = extractJointAnglesDegrees(poses[0]);
							const angleFeatures = jointAnglesDegrees.map((angle) => normalizeAngleDegrees(angle));
							const angleDifferenceFeatures = buildAngleDifferenceFeatures(stepName, jointAnglesDegrees);
							const movementFeature = computeMovementFeature(keypointFeatures, previousKeypointFeatures);
							const bodyRatioFeatures = computeBodyRatioFeatures(keypointFeatures);
							const indirect = generateIndirectParameters();
							const classOneHot = toOneHot(label, LABELS);
							const combinedFeatures = [
								...keypointFeatures,
								...angleFeatures,
								...angleDifferenceFeatures,
								movementFeature,
								...bodyRatioFeatures,
								indirect.normalizedAge,
								...indirect.flexibilityOneHot,
								...indirect.experienceOneHot,
							];

							dataset.push({
								pose: poseName,
								step: stepName,
								label,
								labelOneHot: classOneHot,
								keypointFeatures,
								jointAngleFeatures: angleFeatures,
								jointAngleDifferenceFeatures: angleDifferenceFeatures,
								movementFeature,
								bodyRatioFeatures,
								indirect,
								features: combinedFeatures,
								featureLayout: {
									keypointCount: 34,
									jointAngleCount: 8,
									jointAngleOrder: JOINT_ANGLE_ORDER,
									jointAngleDifferenceCount: 8,
									movementCount: 1,
									bodyRatioCount: 3,
									ageCount: 1,
									flexibilityOneHotCount: 3,
									experienceOneHotCount: 3,
									totalCount: 61,
								},
								featureType: 'normalized_keypoints_joint_angles_deltas_movement_bodyratios_plus_indirect',
								augmentation: variant.tag,
								image: path.relative(ROOT_DIR, variant.imagePath),
							});

							previousKeypointFeatures = keypointFeatures;

							labelCounts[label] += 1;
						} catch (error) {
							console.error(`Failed to process ${variant.imagePath} (${variant.tag}): ${error.message}`);
						} finally {
							if (imageTensor) {
								imageTensor.dispose();
							}
						}
					}
				}
			}

			console.log(
				`Summary (${poseName}/${stepName}) -> correct: ${labelCounts.correct}, moderate: ${labelCounts.moderate}, incorrect: ${labelCounts.incorrect}`
			);

			const outputFile = path.join(OUTPUT_DIR, buildOutputFileName(poseName, stepName));
			outputDatasets.push({ poseName, stepName, outputFile, dataset, labelCounts });
		}
	}

	if (typeof detector.dispose === 'function') {
		detector.dispose();
	}

	return outputDatasets;
}

async function run() {
	const outputDatasets = await buildStepwiseDatasets();
	await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

	for (const { poseName, stepName, outputFile, dataset, labelCounts } of outputDatasets) {
		fs.writeFileSync(outputFile, JSON.stringify(dataset, null, 2), 'utf-8');
		console.log(`Saved ${dataset.length} samples to ${outputFile}`);
		console.log(`Preview (${poseName}/${stepName}):`, dataset.slice(0, 3));
		console.log(
			`Saved summary (${poseName}/${stepName}) -> correct: ${labelCounts.correct}, moderate: ${labelCounts.moderate}, incorrect: ${labelCounts.incorrect}`
		);
	}
}

run().catch((error) => {
	console.error('Fatal error while building pose dataset:', error);
	process.exitCode = 1;
});

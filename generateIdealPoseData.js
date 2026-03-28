const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const DATASETS_DIR = path.join(ROOT_DIR, 'datasets', 'konasana');
const OUTPUT_FILE = path.join(ROOT_DIR, 'public', 'ideal_pose_data.json');
const ROOT_OUTPUT_FILE = path.join(ROOT_DIR, 'ideal_pose_data.json');

const STEP_DATASET_FILES = {
	step1: 'step1_dataset.json',
	step2: 'step2_dataset.json',
	step3: 'step3_dataset.json',
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

function averageVectors(vectors, expectedLength) {
	if (!Array.isArray(vectors) || vectors.length === 0) {
		throw new Error('Cannot average an empty vector set.');
	}

	const sums = new Array(expectedLength).fill(0);
	for (const vector of vectors) {
		if (!Array.isArray(vector) || vector.length !== expectedLength) {
			throw new Error(`Invalid vector length. Expected ${expectedLength}.`);
		}
		for (let i = 0; i < expectedLength; i += 1) {
			sums[i] += Number(vector[i]) || 0;
		}
	}

	return sums.map((sum) => sum / vectors.length);
}

function toDegreesIfNormalized(angleFeatureArray) {
	return angleFeatureArray.map((value) => {
		const numeric = Number(value) || 0;
		return numeric <= 1.000001 ? numeric * 180 : numeric;
	});
}

function loadStepDataset(stepKey, datasetFileName) {
	const filePath = path.join(DATASETS_DIR, datasetFileName);
	if (!fs.existsSync(filePath)) {
		throw new Error(`Dataset file missing for ${stepKey}: ${filePath}`);
	}

	const raw = fs.readFileSync(filePath, 'utf-8');
	const data = JSON.parse(raw);
	if (!Array.isArray(data) || data.length === 0) {
		throw new Error(`Dataset is empty or invalid: ${filePath}`);
	}

	const correctSamples = data.filter((sample) => sample && sample.label === 'correct');
	if (correctSamples.length === 0) {
		throw new Error(`No correct samples found in ${datasetFileName}`);
	}

	const keypointVectors = correctSamples.map((sample) => sample.keypointFeatures);
	const angleVectorsNormalized = correctSamples.map((sample) => sample.jointAngleFeatures);

	const idealKeypoints = averageVectors(keypointVectors, 34);
	const avgAnglesNormalized = averageVectors(angleVectorsNormalized, 8);
	const idealAngles = toDegreesIfNormalized(avgAnglesNormalized);

	return {
		idealKeypoints,
		idealAngles,
	};
}

function buildIdealPoseData() {
	const output = {
		angleOrder: JOINT_ANGLE_ORDER,
	};

	for (const [stepKey, fileName] of Object.entries(STEP_DATASET_FILES)) {
		output[stepKey] = {
			...loadStepDataset(stepKey, fileName),
			angleOrder: JOINT_ANGLE_ORDER,
		};
	}

	return output;
}

function main() {
	const idealPoseData = buildIdealPoseData();
	fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
	fs.writeFileSync(OUTPUT_FILE, JSON.stringify(idealPoseData, null, 2), 'utf-8');
	fs.writeFileSync(ROOT_OUTPUT_FILE, JSON.stringify(idealPoseData, null, 2), 'utf-8');
	console.log(`Saved ideal pose data to ${OUTPUT_FILE}`);
}

main();

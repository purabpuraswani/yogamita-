const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');

const ROOT_DIR = process.cwd();
const DATASETS_DIR = path.join(ROOT_DIR, 'datasets');
const MODEL_DIR = path.join(ROOT_DIR, 'model');
const OUTPUT_SIZE = 3;
const EPOCHS = 100;
const BATCH_SIZE = 4;
const VALIDATION_SPLIT = 0.2;
const LEARNING_RATE = 0.001;
const EARLY_STOPPING_PATIENCE = 10;
const K_FOLDS = 5;
const STEP_KEYS = ['step1', 'step2', 'step3'];
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

function findDatasetForStep(stepKey) {
	const directPath = path.join(DATASETS_DIR, `konasana_${stepKey}_dataset.json`);
	if (fs.existsSync(directPath)) {
		return directPath;
	}

	if (!fs.existsSync(DATASETS_DIR)) {
		throw new Error(`datasets directory not found: ${DATASETS_DIR}`);
	}

	const candidates = fs
		.readdirSync(DATASETS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(`_${stepKey}_dataset.json`))
		.map((entry) => path.join(DATASETS_DIR, entry.name));

	if (candidates.length === 1) {
		return candidates[0];
	}

	if (candidates.length > 1) {
		throw new Error(
			`Multiple datasets matched for ${stepKey}: ${candidates.join(', ')}. Keep only one or use konasana_${stepKey}_dataset.json.`
		);
	}

	throw new Error(`No dataset file found for ${stepKey}. Expected ${directPath} or *_${stepKey}_dataset.json in ${DATASETS_DIR}.`);
}

function loadDataset(datasetPath) {
	if (!fs.existsSync(datasetPath)) {
		throw new Error(`Dataset file not found: ${datasetPath}`);
	}

	const raw = fs.readFileSync(datasetPath, 'utf-8');
	const data = JSON.parse(raw);

	if (!Array.isArray(data) || data.length === 0) {
		throw new Error(`${path.basename(datasetPath)} is empty or invalid.`);
	}

	const features = [];
	const labels = [];
	let featureSize = null;

	for (const [index, sample] of data.entries()) {
		if (!Array.isArray(sample.features) || sample.features.length === 0) {
			throw new Error(`Invalid features at sample ${index}. Expected non-empty feature array.`);
		}

		const declaredOrder = sample?.featureLayout?.jointAngleOrder;
		if (Array.isArray(declaredOrder) && declaredOrder.length === JOINT_ANGLE_ORDER.length) {
			const sameOrder = declaredOrder.every((value, i) => value === JOINT_ANGLE_ORDER[i]);
			if (!sameOrder) {
				throw new Error(
					`Angle order mismatch at sample ${index}. Expected ${JOINT_ANGLE_ORDER.join(', ')}.`
				);
			}
		}

		if (featureSize === null) {
			featureSize = sample.features.length;
		}

		if (sample.features.length !== featureSize) {
			throw new Error(`Invalid features at sample ${index}. Expected ${featureSize} values.`);
		}
		if (!Array.isArray(sample.labelOneHot) || sample.labelOneHot.length !== OUTPUT_SIZE) {
			throw new Error(`Invalid labelOneHot at sample ${index}. Expected ${OUTPUT_SIZE} values.`);
		}

		features.push(sample.features.map(Number));
		labels.push(sample.labelOneHot.map(Number));
	}

	return { features, labels, sampleCount: data.length, featureSize };
}

function createModel(inputSize) {
	const model = tf.sequential();

	model.add(tf.layers.dense({
		units: 128,
		activation: 'relu',
		inputShape: [inputSize],
	}));
	model.add(tf.layers.dropout({ rate: 0.3 }));
	model.add(tf.layers.dense({
		units: 64,
		activation: 'relu',
	}));
	model.add(tf.layers.dropout({ rate: 0.3 }));
	model.add(tf.layers.dense({
		units: 32,
		activation: 'relu',
	}));
	model.add(tf.layers.dense({
		units: OUTPUT_SIZE,
		activation: 'softmax',
	}));

	model.compile({
		optimizer: tf.train.adam(LEARNING_RATE),
		loss: 'categoricalCrossentropy',
		metrics: ['accuracy'],
	});

	return model;
}

function createEarlyStoppingCallback() {
	return tf.callbacks.earlyStopping({
		monitor: 'val_loss',
		patience: EARLY_STOPPING_PATIENCE,
	});
}

function shuffleIndices(length) {
	const indices = Array.from({ length }, (_, i) => i);
	tf.util.shuffle(indices);
	return indices;
}

function buildFolds(sampleCount, foldCount) {
	const indices = shuffleIndices(sampleCount);
	const folds = [];
	for (let i = 0; i < foldCount; i += 1) {
		const start = Math.floor((i * sampleCount) / foldCount);
		const end = Math.floor(((i + 1) * sampleCount) / foldCount);
		folds.push(indices.slice(start, end));
	}
	return folds;
}

function pickRows(rows, indices) {
	return indices.map((idx) => rows[idx]);
}

async function runKFoldCrossValidation(stepKey, features, labels, featureSize) {
	const foldCount = Math.min(K_FOLDS, features.length);
	if (foldCount < 2) {
		console.warn(`[${stepKey}] Skipping k-fold CV because sample count is too small.`);
		return null;
	}

	const folds = buildFolds(features.length, foldCount);
	const foldAccuracies = [];

	for (let foldIndex = 0; foldIndex < foldCount; foldIndex += 1) {
		const valIndices = folds[foldIndex];
		const trainIndices = [];
		for (let i = 0; i < foldCount; i += 1) {
			if (i !== foldIndex) {
				trainIndices.push(...folds[i]);
			}
		}

		const xTrainRows = pickRows(features, trainIndices);
		const yTrainRows = pickRows(labels, trainIndices);
		const xValRows = pickRows(features, valIndices);
		const yValRows = pickRows(labels, valIndices);

		const xTrain = tf.tensor2d(xTrainRows, [xTrainRows.length, featureSize], 'float32');
		const yTrain = tf.tensor2d(yTrainRows, [yTrainRows.length, OUTPUT_SIZE], 'float32');
		const xVal = tf.tensor2d(xValRows, [xValRows.length, featureSize], 'float32');
		const yVal = tf.tensor2d(yValRows, [yValRows.length, OUTPUT_SIZE], 'float32');

		const model = createModel(featureSize);

		const history = await model.fit(xTrain, yTrain, {
			epochs: EPOCHS,
			batchSize: BATCH_SIZE,
			shuffle: true,
			validationData: [xVal, yVal],
			callbacks: [createEarlyStoppingCallback()],
			verbose: 0,
		});

		const valAccHistory = history.history.val_acc || history.history.val_accuracy || [];
		const foldAcc = valAccHistory.length > 0 ? Number(valAccHistory[valAccHistory.length - 1]) : 0;
		foldAccuracies.push(foldAcc);
		console.log(`[${stepKey}] Fold ${foldIndex + 1}/${foldCount} validation accuracy: ${(foldAcc * 100).toFixed(2)}%`);

		xTrain.dispose();
		yTrain.dispose();
		xVal.dispose();
		yVal.dispose();
		model.dispose();
	}

	const avgAcc = foldAccuracies.reduce((sum, acc) => sum + acc, 0) / foldAccuracies.length;
	console.log(`[${stepKey}] ${foldCount}-fold average validation accuracy: ${(avgAcc * 100).toFixed(2)}%`);
	return avgAcc;
}

async function saveModelToFolder(model, targetDir) {
	await fs.promises.mkdir(targetDir, { recursive: true });

	await model.save(
		tf.io.withSaveHandler(async (artifacts) => {
			const modelJsonPath = path.join(targetDir, 'model.json');
			const weightsBinPath = path.join(targetDir, 'weights.bin');

			const modelJson = {
				modelTopology: artifacts.modelTopology,
				weightsManifest: [
					{
						paths: ['weights.bin'],
						weights: artifacts.weightSpecs,
					},
				],
			};

			fs.writeFileSync(modelJsonPath, JSON.stringify(modelJson, null, 2), 'utf-8');
			fs.writeFileSync(weightsBinPath, Buffer.from(artifacts.weightData));

			return {
				modelArtifactsInfo: {
					dateSaved: new Date(),
					modelTopologyType: 'JSON',
					modelTopologyBytes: artifacts.modelTopology
						? Buffer.byteLength(JSON.stringify(artifacts.modelTopology), 'utf-8')
						: 0,
					weightSpecsBytes: Buffer.byteLength(JSON.stringify(artifacts.weightSpecs), 'utf-8'),
					weightDataBytes: artifacts.weightData ? artifacts.weightData.byteLength : 0,
				},
			};
		})
	);
}

async function trainSingleStep(stepKey) {
	const datasetPath = findDatasetForStep(stepKey);
	const { features, labels, sampleCount, featureSize } = loadDataset(datasetPath);
	console.log(`\n[${stepKey}] Loaded ${sampleCount} samples from ${path.basename(datasetPath)} (featureSize=${featureSize})`);

	await runKFoldCrossValidation(stepKey, features, labels, featureSize);

	const xs = tf.tensor2d(features, [features.length, featureSize], 'float32');
	const ys = tf.tensor2d(labels, [labels.length, OUTPUT_SIZE], 'float32');

	const model = createModel(featureSize);
	model.summary();

	const history = await model.fit(xs, ys, {
		epochs: EPOCHS,
		batchSize: BATCH_SIZE,
		shuffle: true,
		validationSplit: sampleCount >= 5 ? VALIDATION_SPLIT : 0,
		callbacks: sampleCount >= 5 ? [createEarlyStoppingCallback()] : [],
		verbose: 1,
	});

	const trainAccHistory = history.history.acc || history.history.accuracy || [];
	const trainLossHistory = history.history.loss || [];
	const finalTrainAcc = trainAccHistory.length > 0 ? trainAccHistory[trainAccHistory.length - 1] : null;
	const finalTrainLoss = trainLossHistory.length > 0 ? trainLossHistory[trainLossHistory.length - 1] : null;

	if (finalTrainAcc !== null) {
		console.log(`[${stepKey}] Final training accuracy: ${(Number(finalTrainAcc) * 100).toFixed(2)}%`);
	}
	if (finalTrainLoss !== null) {
		console.log(`[${stepKey}] Final training loss: ${Number(finalTrainLoss).toFixed(6)}`);
	}

	const targetDir = path.join(MODEL_DIR, `${stepKey}_model`);
	await saveModelToFolder(model, targetDir);
	console.log(`[${stepKey}] Model saved to ${targetDir}`);

	xs.dispose();
	ys.dispose();
	model.dispose();
}

async function main() {
	await tf.setBackend('cpu');
	await tf.ready();

	await fs.promises.mkdir(MODEL_DIR, { recursive: true });

	for (const stepKey of STEP_KEYS) {
		await trainSingleStep(stepKey);
	}

	console.log('\nCompleted step-wise training for step1, step2, and step3 models.');
}

main().catch((error) => {
	console.error('Training failed:', error);
	process.exitCode = 1;
});

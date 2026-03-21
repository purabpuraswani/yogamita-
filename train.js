const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');

const ROOT_DIR = process.cwd();
const DATASET_PATH = path.join(ROOT_DIR, 'pose_dataset.json');
const MODEL_DIR = path.join(ROOT_DIR, 'model');
const INPUT_SIZE = 41;
const OUTPUT_SIZE = 3;

function loadDataset() {
	if (!fs.existsSync(DATASET_PATH)) {
		throw new Error(`Dataset file not found: ${DATASET_PATH}`);
	}

	const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
	const data = JSON.parse(raw);

	if (!Array.isArray(data) || data.length === 0) {
		throw new Error('pose_dataset.json is empty or invalid.');
	}

	const features = [];
	const labels = [];

	for (const [index, sample] of data.entries()) {
		if (!Array.isArray(sample.features) || sample.features.length !== INPUT_SIZE) {
			throw new Error(`Invalid features at sample ${index}. Expected ${INPUT_SIZE} values.`);
		}
		if (!Array.isArray(sample.labelOneHot) || sample.labelOneHot.length !== OUTPUT_SIZE) {
			throw new Error(`Invalid labelOneHot at sample ${index}. Expected ${OUTPUT_SIZE} values.`);
		}

		features.push(sample.features.map(Number));
		labels.push(sample.labelOneHot.map(Number));
	}

	return { features, labels, sampleCount: data.length };
}

function createModel() {
	const model = tf.sequential();

	model.add(tf.layers.dense({
		units: 64,
		activation: 'relu',
		inputShape: [INPUT_SIZE],
	}));
	model.add(tf.layers.dense({
		units: 32,
		activation: 'relu',
	}));
	model.add(tf.layers.dense({
		units: OUTPUT_SIZE,
		activation: 'softmax',
	}));

	model.compile({
		optimizer: tf.train.adam(0.001),
		loss: 'categoricalCrossentropy',
		metrics: ['accuracy'],
	});

	return model;
}

async function saveModelToFolder(model) {
	await fs.promises.mkdir(MODEL_DIR, { recursive: true });

	await model.save(
		tf.io.withSaveHandler(async (artifacts) => {
			const modelJsonPath = path.join(MODEL_DIR, 'model.json');
			const weightsBinPath = path.join(MODEL_DIR, 'weights.bin');

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

async function main() {
	await tf.setBackend('cpu');
	await tf.ready();

	const { features, labels, sampleCount } = loadDataset();
	console.log(`Loaded ${sampleCount} samples from pose_dataset.json`);

	const xs = tf.tensor2d(features, [features.length, INPUT_SIZE], 'float32');
	const ys = tf.tensor2d(labels, [labels.length, OUTPUT_SIZE], 'float32');

	const model = createModel();
	model.summary();

	const history = await model.fit(xs, ys, {
		epochs: 60,
		batchSize: Math.min(8, sampleCount),
		shuffle: true,
		validationSplit: sampleCount >= 5 ? 0.2 : 0,
		verbose: 1,
	});

	const trainAccHistory = history.history.acc || history.history.accuracy || [];
	const trainLossHistory = history.history.loss || [];
	const finalTrainAcc = trainAccHistory.length > 0 ? trainAccHistory[trainAccHistory.length - 1] : null;
	const finalTrainLoss = trainLossHistory.length > 0 ? trainLossHistory[trainLossHistory.length - 1] : null;

	if (finalTrainAcc !== null) {
		console.log(`Final training accuracy: ${(Number(finalTrainAcc) * 100).toFixed(2)}%`);
	}
	if (finalTrainLoss !== null) {
		console.log(`Final training loss: ${Number(finalTrainLoss).toFixed(6)}`);
	}

	await saveModelToFolder(model);
	console.log(`Model saved to ${MODEL_DIR}`);

	xs.dispose();
	ys.dispose();
	model.dispose();
}

main().catch((error) => {
	console.error('Training failed:', error);
	process.exitCode = 1;
});

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');
const poseDetection = require('@tensorflow-models/pose-detection');
const sharp = require('sharp');

const ROOT_DIR = process.cwd();
const IMAGE_DIR = path.join(ROOT_DIR, 'images');
const OUTPUT_FILE = path.join(ROOT_DIR, 'pose_dataset.json');

const LABELS = ['correct', 'moderate', 'incorrect'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);
const FLEXIBILITY_LEVELS = ['low', 'medium', 'high'];
const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'];

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

async function getImagePathsForLabel(label) {
	const folder = path.join(IMAGE_DIR, label);

	if (!fs.existsSync(folder)) {
		console.warn(`Skipping missing folder: ${folder}`);
		return [];
	}

	const entries = await fs.promises.readdir(folder, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && isImageFile(entry.name))
		.map((entry) => path.join(folder, entry.name));
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
		flexibility,
		experience,
		flexibilityOneHot: toOneHot(flexibility, FLEXIBILITY_LEVELS),
		experienceOneHot: toOneHot(experience, EXPERIENCE_LEVELS),
	};
}

async function buildDataset() {
	await tf.setBackend('cpu');
	await tf.ready();

	const detector = await poseDetection.createDetector(
		poseDetection.SupportedModels.MoveNet,
		{
			runtime: 'tfjs',
			modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
		}
	);

	const dataset = [];

	for (const label of LABELS) {
		const imagePaths = await getImagePathsForLabel(label);
		console.log(`Processing ${imagePaths.length} images for label: ${label}`);

		for (const imagePath of imagePaths) {
			let imageTensor;
			let width;
			let height;

			try {
				const imageInfo = await imageFileToTensor(imagePath);
				imageTensor = imageInfo.tensor;
				width = imageInfo.width;
				height = imageInfo.height;

				const poses = await detector.estimatePoses(imageTensor);
				const keypointFeatures = poseToFeatureArray(poses[0], width, height);
				const indirect = generateIndirectParameters();
				const classOneHot = toOneHot(label, LABELS);
				const combinedFeatures = [
					...keypointFeatures,
					indirect.age,
					...indirect.flexibilityOneHot,
					...indirect.experienceOneHot,
				];

				dataset.push({
					label,
					labelOneHot: classOneHot,
					keypointFeatures,
					indirect,
					features: combinedFeatures,
					featureLayout: {
						keypointCount: 34,
						ageCount: 1,
						flexibilityOneHotCount: 3,
						experienceOneHotCount: 3,
						totalCount: 41,
					},
					featureType: 'normalized_keypoints_plus_indirect',
					image: path.relative(ROOT_DIR, imagePath),
				});
			} catch (error) {
				console.error(`Failed to process ${imagePath}: ${error.message}`);
			} finally {
				if (imageTensor) {
					imageTensor.dispose();
				}
			}
		}
	}

	if (typeof detector.dispose === 'function') {
		detector.dispose();
	}

	return dataset;
}

async function run() {
	const dataset = await buildDataset();

	fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dataset, null, 2), 'utf-8');

	console.log(`Saved ${dataset.length} samples to ${OUTPUT_FILE}`);
	console.log('Preview:', dataset.slice(0, 3));
}

run().catch((error) => {
	console.error('Fatal error while building pose dataset:', error);
	process.exitCode = 1;
});

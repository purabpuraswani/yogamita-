const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const predictionEl = document.getElementById('prediction');
const confidenceEl = document.getElementById('confidence');
const ageInput = document.getElementById('ageInput');
const flexibilitySelect = document.getElementById('flexibilitySelect');
const experienceSelect = document.getElementById('experienceSelect');

const LABELS = ['correct', 'moderate', 'incorrect'];
const FLEXIBILITY_LEVELS = ['low', 'medium', 'high'];
const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'];

let detector;
let classifier;
let rafId;

function toOneHot(value, classes) {
	return classes.map((item) => (item === value ? 1 : 0));
}

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

function getIndirectFeatures() {
	const age = clamp(Number(ageInput.value) || 20, 20, 60);
	const flexibility = flexibilitySelect.value;
	const experience = experienceSelect.value;

	return [
		age,
		...toOneHot(flexibility, FLEXIBILITY_LEVELS),
		...toOneHot(experience, EXPERIENCE_LEVELS),
	];
}

function drawKeypoints(ctx, keypoints, width, height) {
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = '#39ff88';
	for (const kp of keypoints) {
		if ((kp.score ?? 1) < 0.2) {
			continue;
		}
		ctx.beginPath();
		ctx.arc(kp.x, kp.y, 4, 0, Math.PI * 2);
		ctx.fill();
	}
}

function extractNormalizedKeypoints(pose, width, height) {
	const features = [];
	const safeWidth = width > 0 ? width : 1;
	const safeHeight = height > 0 ? height : 1;

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

async function setupWebcam() {
	const stream = await navigator.mediaDevices.getUserMedia({
		video: { facingMode: 'user', width: 640, height: 480 },
		audio: false,
	});
	video.srcObject = stream;

	await new Promise((resolve) => {
		video.onloadedmetadata = () => resolve();
	});
	await video.play();

	overlay.width = video.videoWidth;
	overlay.height = video.videoHeight;
}

async function initModels() {
	await tf.setBackend('webgl');
	await tf.ready();

	detector = await poseDetection.createDetector(
		poseDetection.SupportedModels.MoveNet,
		{
			runtime: 'tfjs',
			modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
		}
	);

	classifier = await tf.loadLayersModel('model/model.json');
}

async function classifyFrame() {
	const ctx = overlay.getContext('2d');

	const poses = await detector.estimatePoses(video, {
		flipHorizontal: true,
	});

	if (!poses.length) {
		predictionEl.textContent = 'No person detected';
		confidenceEl.textContent = 'Confidence: -';
		ctx.clearRect(0, 0, overlay.width, overlay.height);
		rafId = requestAnimationFrame(classifyFrame);
		return;
	}

	const pose = poses[0];
	drawKeypoints(ctx, pose.keypoints, overlay.width, overlay.height);

	const keypointFeatures = extractNormalizedKeypoints(pose, overlay.width, overlay.height);
	const indirectFeatures = getIndirectFeatures();
	const fullFeatures = [...keypointFeatures, ...indirectFeatures];

	const input = tf.tensor2d([fullFeatures], [1, 41], 'float32');
	const probsTensor = classifier.predict(input);
	const probs = await probsTensor.data();

	input.dispose();
	probsTensor.dispose();

	let bestIndex = 0;
	for (let i = 1; i < probs.length; i += 1) {
		if (probs[i] > probs[bestIndex]) {
			bestIndex = i;
		}
	}

	const bestLabel = LABELS[bestIndex];
	const bestConfidence = probs[bestIndex];

	predictionEl.textContent = `Pose: ${bestLabel.toUpperCase()}`;
	confidenceEl.textContent = `Confidence: ${(bestConfidence * 100).toFixed(1)}%`;

	rafId = requestAnimationFrame(classifyFrame);
}

async function start() {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error('Webcam is not supported in this browser.');
	}

	statusEl.textContent = 'Starting camera...';
	await setupWebcam();

	statusEl.textContent = 'Loading MoveNet and classifier model...';
	await initModels();

	statusEl.textContent = 'Running real-time classification';
	await classifyFrame();
}

window.addEventListener('beforeunload', () => {
	if (rafId) {
		cancelAnimationFrame(rafId);
	}
	if (detector && typeof detector.dispose === 'function') {
		detector.dispose();
	}
});

start().catch((error) => {
	statusEl.textContent = `Error: ${error.message}`;
	console.error(error);
});

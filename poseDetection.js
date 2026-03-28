const LEFT_SHOULDER = 5;
const RIGHT_SHOULDER = 6;
const LEFT_HIP = 11;
const RIGHT_HIP = 12;

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

function drawPose(ctx, detectorModel, pose, width, height, sourceVideoEl) {
	ctx.clearRect(0, 0, width, height);

	// Always paint the live camera frame first so the markers panel shows
	// user video plus keypoints, even if the underlying video layer is hidden.
	if (sourceVideoEl && sourceVideoEl.readyState >= 2) {
		ctx.drawImage(sourceVideoEl, 0, 0, width, height);
	}

	if (!pose) {
		return;
	}

	ctx.lineWidth = 3;
	ctx.strokeStyle = '#3ef4ab';
	ctx.fillStyle = '#7fffd3';

	const pairs = window.poseDetection.util.getAdjacentPairs(detectorModel);
	for (const [aIndex, bIndex] of pairs) {
		const a = pose.keypoints[aIndex];
		const b = pose.keypoints[bIndex];
		if (!a || !b || (a.score ?? 1) < 0.2 || (b.score ?? 1) < 0.2) {
			continue;
		}
		ctx.beginPath();
		ctx.moveTo(a.x, a.y);
		ctx.lineTo(b.x, b.y);
		ctx.stroke();
	}

	for (const kp of pose.keypoints) {
		if ((kp.score ?? 1) < 0.2) {
			continue;
		}
		ctx.beginPath();
		ctx.arc(kp.x, kp.y, 4, 0, Math.PI * 2);
		ctx.fill();
	}
}

export function extractNormalizedKeypoints(pose, width, height) {
	const features = [];
	const safeW = width > 0 ? width : 1;
	const safeH = height > 0 ? height : 1;

	if (!pose || !Array.isArray(pose.keypoints) || pose.keypoints.length < 17) {
		return new Array(34).fill(0);
	}

	for (let i = 0; i < 17; i += 1) {
		const kp = pose.keypoints[i];
		const x = Number.isFinite(kp?.x) ? clamp(kp.x / safeW, 0, 1) : 0;
		const y = Number.isFinite(kp?.y) ? clamp(kp.y / safeH, 0, 1) : 0;
		features.push(x, y);
	}

	return features;
}

export function estimateSideBendMagnitude(pose, width) {
	if (!pose || !pose.keypoints) {
		return 0;
	}
	const ls = pose.keypoints[LEFT_SHOULDER];
	const rs = pose.keypoints[RIGHT_SHOULDER];
	const lh = pose.keypoints[LEFT_HIP];
	const rh = pose.keypoints[RIGHT_HIP];
	if (!ls || !rs || !lh || !rh) {
		return 0;
	}

	const shoulderCenter = (ls.x + rs.x) / 2;
	const hipCenter = (lh.x + rh.x) / 2;
	const safeWidth = width > 0 ? width : 1;
	return Math.abs(shoulderCenter - hipCenter) / safeWidth;
}

export class PoseStream {
	constructor({ rawVideoEl, markedVideoEl, canvasEl, onPoseFrame }) {
		this.rawVideoEl = rawVideoEl;
		this.markedVideoEl = markedVideoEl;
		this.canvasEl = canvasEl;
		this.onPoseFrame = onPoseFrame;
		this.detector = null;
		this.stream = null;
		this.rafId = null;
		this.detectorModel = window.poseDetection.SupportedModels.MoveNet;
	}

	async initDetector() {
		if (this.detector) {
			return;
		}
		this.detector = await window.poseDetection.createDetector(this.detectorModel, {
			runtime: 'tfjs',
			modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
		});
	}

	async setupCamera() {
		this.stream = await navigator.mediaDevices.getUserMedia({
			video: {
				width: { ideal: 1280 },
				height: { ideal: 720 },
				aspectRatio: { ideal: 16 / 9 },
				facingMode: 'user',
			},
			audio: false,
		});

		this.rawVideoEl.srcObject = this.stream;
		this.markedVideoEl.srcObject = this.stream;

		await Promise.all([
			new Promise((resolve) => {
				this.rawVideoEl.onloadedmetadata = () => resolve();
			}),
			new Promise((resolve) => {
				this.markedVideoEl.onloadedmetadata = () => resolve();
			}),
		]);

		await this.rawVideoEl.play();
		await this.markedVideoEl.play();

		this.canvasEl.width = this.markedVideoEl.videoWidth;
		this.canvasEl.height = this.markedVideoEl.videoHeight;
	}

	startLoop() {
		const ctx = this.canvasEl.getContext('2d');
		const tick = async () => {
			const poses = await this.detector.estimatePoses(this.markedVideoEl, { flipHorizontal: true });
			const pose = poses.length > 0 ? poses[0] : null;
			const width = this.canvasEl.width;
			const height = this.canvasEl.height;
			drawPose(ctx, this.detectorModel, pose, width, height, this.markedVideoEl);

			this.onPoseFrame({
				pose,
				keypointFeatures: extractNormalizedKeypoints(pose, width, height),
				frameWidth: width,
			});

			this.rafId = requestAnimationFrame(tick);
		};

		this.rafId = requestAnimationFrame(tick);
	}

	async start() {
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error('Webcam API not available in this browser.');
		}

		await this.initDetector();
		await this.setupCamera();
		this.startLoop();
	}

	stop() {
		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (this.stream) {
			for (const track of this.stream.getTracks()) {
				track.stop();
			}
		}
		if (this.detector && typeof this.detector.dispose === 'function') {
			this.detector.dispose();
		}
	}
}

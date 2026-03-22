import { clearSession, initLogin } from './login.js';
import {
	initDashboard,
	renderPrediction,
	renderStatus,
	renderReport,
	setWelcomeText,
	renderSessionSummary,
	setSessionControlState,
	renderLiveCoachTip,
} from './dashboard.js';
import { PoseStream, estimateSideBendMagnitude } from './poseDetection.js';
import { PredictionEngine } from './prediction.js';
import { generateFeedback } from './feedback.js';
import { generateYogaReport } from './report.js';

const appState = {
	user: null,
	userProfile: null,
	asana: 'Konasana',
	latestPrediction: null,
	latestFeedback: [],
	latestScore: 0,
	sessionActive: false,
	sessionPredictions: [],
	sessionScores: [],
	correctCount: 0,
	moderateCount: 0,
	incorrectCount: 0,
	skippedFrameCount: 0,
	sessionStartTime: null,
	sessionReport: null,
	lastValidSnapshot: null,
	bestSnapshot: null,
	recentSnapshots: [],
	stability: {
		label: null,
		streak: 0,
	},
	lastLiveCoachAt: 0,
	lastMonitorTipAt: 0,
	lastPoseReadyAt: 0,
};

const rawVideoEl = document.getElementById('rawVideo');
const markedVideoEl = document.getElementById('markedVideo');
const canvasEl = document.getElementById('poseCanvas');
const downloadReportBtn = document.getElementById('downloadReportBtn');

let latestReportText = '';

const predictor = new PredictionEngine('model/model.json');
let poseStream = null;
let busyPredicting = false;
let lastPredictionAt = 0;
const STABLE_CAPTURE_FRAMES = 5;
const STABLE_CAPTURE_MIN_CONFIDENCE = 0.55;

function setDownloadReportState(enabled) {
	if (!downloadReportBtn) {
		return;
	}

	downloadReportBtn.disabled = !enabled;
}

function buildReportFileName() {
	const asanaSlug = (appState.asana || 'asana')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'asana';
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `yogmitra-report-${asanaSlug}-${stamp}.txt`;
}

function downloadReportAsText() {
	if (!latestReportText.trim()) {
		renderStatus('No generated report available to download yet.');
		setDownloadReportState(false);
		return;
	}

	const reportBlob = new Blob([latestReportText], { type: 'text/plain;charset=utf-8' });
	const downloadUrl = URL.createObjectURL(reportBlob);
	const link = document.createElement('a');
	link.href = downloadUrl;
	link.download = buildReportFileName();
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(downloadUrl);
	renderStatus('Report downloaded successfully.');
}

const KP = {
	LEFT_SHOULDER: 5,
	RIGHT_SHOULDER: 6,
	LEFT_WRIST: 9,
	RIGHT_WRIST: 10,
};

function isPoseReadyForClassification(pose) {
	if (!pose || !Array.isArray(pose.keypoints) || pose.keypoints.length < 17) {
		return false;
	}

	const keypoints = pose.keypoints;
	const confidentCount = keypoints.filter((kp) => (kp?.score ?? 0) >= 0.3).length;
	const required = [5, 6, 11, 12, 13, 14, 15, 16];
	const requiredVisible = required.filter((idx) => (keypoints[idx]?.score ?? 0) >= 0.35).length;

	return confidentCount >= 10 && requiredVisible >= 5;
}

function applyKonasanaQualityGuards(pose, prediction) {
	if (!pose || !Array.isArray(pose.keypoints)) {
		return prediction;
	}

	const keypoints = pose.keypoints;
	const sideBend = estimateSideBendMagnitude(pose, canvasEl.width || 1);
	const shoulderY = Math.min(
		keypoints[KP.LEFT_SHOULDER]?.y ?? Number.POSITIVE_INFINITY,
		keypoints[KP.RIGHT_SHOULDER]?.y ?? Number.POSITIVE_INFINITY
	);
	const wristY = Math.min(
		keypoints[KP.LEFT_WRIST]?.y ?? Number.POSITIVE_INFINITY,
		keypoints[KP.RIGHT_WRIST]?.y ?? Number.POSITIVE_INFINITY
	);
	const armRaised = Number.isFinite(shoulderY) && Number.isFinite(wristY) && wristY < shoulderY - 20;

	if (prediction.label === 'correct') {
		if (sideBend < 0.035 && !armRaised) {
			return {
				...prediction,
				label: 'incorrect',
				confidence: Math.min(prediction.confidence, 0.45),
			};
		}
		if (sideBend < 0.05 || !armRaised) {
			return {
				...prediction,
				label: 'moderate',
				confidence: Math.min(prediction.confidence, 0.6),
			};
		}
	}

	return prediction;
}

function getLabelBonus(label) {
	if (label === 'correct') return 5;
	if (label === 'moderate') return 2;
	return 0;
}

function getFrameScore(label) {
	if (label === 'correct') return 10;
	if (label === 'moderate') return 6;
	return 2;
}

function isSeniorLeniencyEnabled(age) {
	return Number(age) > 50;
}

function getAdjustedFrameScore(label, age) {
	if (!isSeniorLeniencyEnabled(age)) {
		return getFrameScore(label);
	}

	if (label === 'correct') return 10;
	if (label === 'moderate') return 7;
	return 3;
}

function getSessionResultThresholds(age) {
	if (isSeniorLeniencyEnabled(age)) {
		return { correctMin: 7.2, moderateMin: 4.5 };
	}

	return { correctMin: 8, moderateMin: 5 };
}

function applyAgeLeniencyToLiveScore(score, age) {
	if (!isSeniorLeniencyEnabled(age)) {
		return score;
	}

	const adjusted = (Number(score) || 0) + 0.7;
	return Math.max(0, Math.min(10, adjusted));
}

function mirrorKeypointFeatures(features) {
	if (!Array.isArray(features)) {
		return [];
	}

	const keypointCount = Math.floor(features.length / 2);
	const keypoints = [];
	for (let i = 0; i < keypointCount; i += 1) {
		keypoints.push({
			x: Number(features[i * 2]),
			y: Number(features[i * 2 + 1]),
		});
	}

	const mirrored = keypoints.map((kp) => ({
		x: Number.isFinite(kp.x) ? 1 - kp.x : kp.x,
		y: kp.y,
	}));

	// Swap bilateral landmarks so semantic left/right joints stay aligned after mirroring.
	const bilateralPairs = [
		[1, 2],
		[3, 4],
		[5, 6],
		[7, 8],
		[9, 10],
		[11, 12],
		[13, 14],
		[15, 16],
	];
	for (const [leftIdx, rightIdx] of bilateralPairs) {
		if (leftIdx < mirrored.length && rightIdx < mirrored.length) {
			const temp = mirrored[leftIdx];
			mirrored[leftIdx] = mirrored[rightIdx];
			mirrored[rightIdx] = temp;
		}
	}

	const flattened = [];
	for (const kp of mirrored) {
		flattened.push(kp.x, kp.y);
	}
	return flattened;
}

function getPredictionRank(label) {
	if (label === 'correct') return 2;
	if (label === 'moderate') return 1;
	return 0;
}

function pickBestDirectionalPrediction(primaryPrediction, mirroredPrediction) {
	if (!primaryPrediction) {
		return mirroredPrediction;
	}
	if (!mirroredPrediction) {
		return primaryPrediction;
	}

	const primaryScore = getPredictionRank(primaryPrediction.label) * 2 + (Number(primaryPrediction.confidence) || 0);
	const mirroredScore = getPredictionRank(mirroredPrediction.label) * 2 + (Number(mirroredPrediction.confidence) || 0);

	return mirroredScore > primaryScore ? mirroredPrediction : primaryPrediction;
}

function formatDuration(ms) {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m ${seconds}s`;
}

function resetSessionState() {
	appState.sessionPredictions = [];
	appState.sessionScores = [];
	appState.correctCount = 0;
	appState.moderateCount = 0;
	appState.incorrectCount = 0;
	appState.skippedFrameCount = 0;
	appState.sessionStartTime = null;
	appState.sessionReport = null;
}

function recordSkippedSessionFrame() {
	if (!appState.sessionActive) {
		return;
	}
	appState.skippedFrameCount += 1;
}

function recordSessionFrame(prediction) {
	if (!appState.sessionActive || !prediction?.label) {
		return;
	}

	const frameScore = getAdjustedFrameScore(prediction.label, appState.userProfile?.age);
	appState.sessionPredictions.push({
		label: prediction.label,
		confidence: Number(prediction.confidence) || 0,
		timestamp: Date.now(),
	});
	appState.sessionScores.push(frameScore);

	if (prediction.label === 'correct') {
		appState.correctCount += 1;
	} else if (prediction.label === 'moderate') {
		appState.moderateCount += 1;
	} else {
		appState.incorrectCount += 1;
	}
}

function buildSessionImprovements({ totalFrames, correctFrameCount, moderateFrameCount, incorrectFrameCount, skippedFrameCount }) {
	const improvements = [];
	if (totalFrames === 0) {
		improvements.push('Keep your full body visible in camera so posture frames can be analyzed.');
		return improvements;
	}

	const correctRatio = correctFrameCount / totalFrames;
	const incorrectRatio = incorrectFrameCount / totalFrames;
	const moderateRatio = moderateFrameCount / totalFrames;
	const visibilityIssueRatio = skippedFrameCount / Math.max(1, totalFrames + skippedFrameCount);

	if (visibilityIssueRatio > 0.2) {
		improvements.push('Reduce skipped frames by stepping back and keeping your full body inside the camera frame.');
	}
	if (incorrectRatio >= 0.35) {
		improvements.push('Focus on alignment first: keep arm raised, chest open, and avoid collapsing during side bend.');
	}
	if (moderateRatio >= 0.35) {
		improvements.push('Work on consistency by holding stable form for longer before returning to center.');
	}
	if (correctRatio < 0.5) {
		improvements.push('Slow down transitions and maintain steady breathing to improve pose stability.');
	}

	if (!improvements.length) {
		improvements.push('Good session. Next step: hold the final posture 3-5 seconds longer each repetition.');
	}

	return improvements;
}

function getSessionMonitorTip() {
	const analyzedChecks = appState.correctCount + appState.moderateCount + appState.incorrectCount;
	if (analyzedChecks < 6) {
		return null;
	}

	const consistency = appState.correctCount / analyzedChecks;
	const moderateRatio = appState.moderateCount / analyzedChecks;
	const incorrectRatio = appState.incorrectCount / analyzedChecks;
	const visibilityQuality = analyzedChecks / Math.max(1, analyzedChecks + appState.skippedFrameCount);

	if (visibilityQuality < 0.78) {
		return 'Session monitor: Step slightly back and keep your full body visible for better coaching accuracy.';
	}
	if (incorrectRatio >= 0.35) {
		return 'Session monitor: Open your chest and lift top arm closer to ear before deepening the side bend.';
	}
	if (moderateRatio >= 0.45) {
		return 'Session monitor: Hold each side bend 2-3 seconds longer to improve stability and control.';
	}
	if (consistency >= 0.65) {
		return 'Session monitor: Good control. Keep breathing steady and extend through fingertips to refine form.';
	}

	return 'Session monitor: Move slowly into position and keep knees straight with balanced weight on both feet.';
}

async function startSession() {
	if (appState.sessionActive) {
		return;
	}

	setSessionControlState(true);
	renderStatus('Starting session and webcam...');
	try {
		await startRealtimePipeline();
	} catch (error) {
		appState.sessionActive = false;
		setSessionControlState(false);
		renderStatus(`Could not start session: ${error.message}`);
		return;
	}

	appState.sessionActive = true;
	appState.sessionPredictions = [];
	appState.sessionScores = [];
	appState.correctCount = 0;
	appState.moderateCount = 0;
	appState.incorrectCount = 0;
	appState.skippedFrameCount = 0;
	appState.sessionStartTime = Date.now();
	appState.sessionReport = null;
	appState.lastLiveCoachAt = 0;
	appState.lastMonitorTipAt = 0;

	setSessionControlState(true);
	renderSessionSummary(null);
	renderLiveCoachTip('Session started. Hold pose and follow live cues.');
	renderStatus('Session started. Webcam is live and predictions are being tracked.');
}

function endSession() {
	if (!appState.sessionActive) {
		renderStatus('No active session. Click Start Session first.');
		return;
	}

	appState.sessionActive = false;
	setSessionControlState(false);

	const totalFrames = appState.sessionScores.length;
	const totalScore = appState.sessionScores.reduce((sum, score) => sum + score, 0);
	const averageScore = totalFrames ? totalScore / totalFrames : 0;
	const thresholds = getSessionResultThresholds(appState.userProfile?.age);
	const finalResult = averageScore >= thresholds.correctMin
		? 'Correct'
		: averageScore >= thresholds.moderateMin
			? 'Moderate'
			: 'Incorrect';
	const durationMs = appState.sessionStartTime ? Date.now() - appState.sessionStartTime : 0;
	const totalCapturedFrames = totalFrames + appState.skippedFrameCount;
	const improvements = buildSessionImprovements({
		totalFrames,
		correctFrameCount: appState.correctCount,
		moderateFrameCount: appState.moderateCount,
		incorrectFrameCount: appState.incorrectCount,
		skippedFrameCount: appState.skippedFrameCount,
	});

	appState.sessionReport = {
		asanaName: appState.asana,
		sessionDuration: formatDuration(durationMs),
		sessionDurationMs: durationMs,
		totalCapturedFrames,
		totalFrames,
		correctFrameCount: appState.correctCount,
		moderateFrameCount: appState.moderateCount,
		incorrectFrameCount: appState.incorrectCount,
		skippedFrameCount: appState.skippedFrameCount,
		averageScore,
		finalResult,
		leniencyApplied: isSeniorLeniencyEnabled(appState.userProfile?.age),
		improvements,
	};

	stopRealtimePipeline();

	renderSessionSummary(appState.sessionReport);
	renderLiveCoachTip('Session completed. Start a new session to get live coaching cues.');
	if (!totalFrames) {
		renderStatus('Session ended, but no analyzable pose frames were captured. Keep your full body in frame and try again.');
		return;
	}

	const leniencyNote = appState.sessionReport.leniencyApplied ? ' (age-aware scoring applied)' : '';
	renderStatus(`Session ended. Final result: ${finalResult} (${averageScore.toFixed(2)}/10)${leniencyNote}.`);
}

function buildSnapshot(prediction, feedback, score) {
	const quality = (Number(score) || 0) + getLabelBonus(prediction.label) + (Number(prediction.confidence) || 0) * 2;
	return {
		prediction,
		feedback,
		score,
		capturedAt: Date.now(),
		quality,
	};
}

function registerValidSnapshot(snapshot) {
	appState.lastValidSnapshot = snapshot;
	appState.recentSnapshots.push(snapshot);

	const cutoff = Date.now() - 30000;
	appState.recentSnapshots = appState.recentSnapshots.filter((item) => item.capturedAt >= cutoff);

	if (!appState.bestSnapshot || snapshot.quality > appState.bestSnapshot.quality) {
		appState.bestSnapshot = snapshot;
	}
}

function updateStability(prediction) {
	if (!prediction) {
		appState.stability.label = null;
		appState.stability.streak = 0;
		return;
	}

	if (appState.stability.label === prediction.label) {
		appState.stability.streak += 1;
	} else {
		appState.stability.label = prediction.label;
		appState.stability.streak = 1;
	}
}

function isStableEnoughForCapture(prediction) {
	if (!prediction) {
		return false;
	}

	if (prediction.confidence < STABLE_CAPTURE_MIN_CONFIDENCE) {
		return false;
	}

	if (prediction.label === 'correct') {
		return appState.stability.label === 'correct' && appState.stability.streak >= STABLE_CAPTURE_FRAMES;
	}

	if (prediction.label === 'moderate') {
		return appState.stability.label === 'moderate' && appState.stability.streak >= Math.max(3, STABLE_CAPTURE_FRAMES - 1);
	}

	return false;
}

function getBestRecentSnapshot(maxAgeMs = 30000) {
	const cutoff = Date.now() - maxAgeMs;
	const candidates = appState.recentSnapshots.filter((item) => item.capturedAt >= cutoff);
	if (!candidates.length) {
		return null;
	}
	return candidates.reduce((best, current) => (current.quality > best.quality ? current : best));
}

function resetAnalysisUI() {
	renderPrediction({ label: null, confidence: null, score: null, feedback: [] });
	renderSessionSummary(null);
	setSessionControlState(false);
	renderLiveCoachTip('Start session to get real-time posture cues.');
	renderReport('No report generated yet.');
	latestReportText = '';
	setDownloadReportState(false);
}

function stopRealtimePipeline() {
	if (poseStream) {
		poseStream.stop();
		poseStream = null;
	}
}

function logoutUser() {
	clearSession();
	stopRealtimePipeline();
	appState.user = null;
	appState.userProfile = null;
	appState.latestPrediction = null;
	appState.latestFeedback = [];
	appState.latestScore = 0;
	appState.sessionActive = false;
	resetSessionState();
	appState.lastValidSnapshot = null;
	appState.bestSnapshot = null;
	appState.recentSnapshots = [];
	appState.stability.label = null;
	appState.stability.streak = 0;
	appState.lastLiveCoachAt = 0;
	appState.lastMonitorTipAt = 0;
	appState.lastPoseReadyAt = 0;
	busyPredicting = false;
	lastPredictionAt = 0;

	document.getElementById('dashboardView').classList.add('hidden');
	document.getElementById('profileModal').classList.add('hidden');
	document.getElementById('loginView').classList.remove('hidden');

	resetAnalysisUI();
	renderStatus('Logged out. Please sign in again.');
}

async function onPoseFrame({ pose, keypointFeatures }) {
	if (busyPredicting || Date.now() - lastPredictionAt < 240 || !appState.userProfile) {
		return;
	}

	busyPredicting = true;
	lastPredictionAt = Date.now();

	try {
		if (!isPoseReadyForClassification(pose)) {
			const recentlyReady = appState.lastPoseReadyAt > 0 && Date.now() - appState.lastPoseReadyAt <= 1500;
			if (recentlyReady && appState.latestPrediction) {
				appState.latestFeedback = ['Tracking is unstable. Hold steady for a moment so posture can be re-evaluated.'];
				appState.stability.label = null;
				appState.stability.streak = 0;
				recordSkippedSessionFrame();
				renderPrediction({
					label: appState.latestPrediction.label,
					confidence: appState.latestPrediction.confidence,
					score: appState.latestScore,
					feedback: appState.latestFeedback,
				});
				return;
			}

			appState.latestPrediction = {
				label: 'incorrect',
				confidence: 0,
				classIndex: 2,
				probabilities: [0, 0, 1],
				inputVector: keypointFeatures,
			};
			appState.latestFeedback = ['Step back so your full body is visible for yoga analysis.'];
			appState.latestScore = 0;
			recordSkippedSessionFrame();
			appState.stability.label = null;
			appState.stability.streak = 0;
			if (appState.sessionActive && Date.now() - appState.lastLiveCoachAt > 900) {
				renderLiveCoachTip('Move back slightly and keep full body in frame for accurate shoulder and waist feedback.');
				appState.lastLiveCoachAt = Date.now();
			}

			renderPrediction({
				label: 'incorrect',
				confidence: 0,
				score: 0,
				feedback: appState.latestFeedback,
			});
			return;
		}

		const primaryPrediction = await predictor.predict(keypointFeatures, appState.userProfile);
		const mirroredFeatures = mirrorKeypointFeatures(keypointFeatures);
		const mirroredPrediction = await predictor.predict(mirroredFeatures, appState.userProfile);
		let prediction = pickBestDirectionalPrediction(primaryPrediction, mirroredPrediction);
		prediction = applyKonasanaQualityGuards(pose, prediction);
		appState.lastPoseReadyAt = Date.now();
		const feedback = generateFeedback({ pose, prediction });
		const liveScore = applyAgeLeniencyToLiveScore(feedback.score, appState.userProfile?.age);
		updateStability(prediction);

		appState.latestPrediction = prediction;
		appState.latestFeedback = feedback.messages;
		appState.latestScore = liveScore;
		recordSessionFrame(prediction);
		const now = Date.now();
		if (appState.sessionActive && now - appState.lastMonitorTipAt > 2600) {
			const monitorTip = getSessionMonitorTip();
			if (monitorTip) {
				renderLiveCoachTip(monitorTip);
				appState.lastMonitorTipAt = now;
				appState.lastLiveCoachAt = now;
			}
		}
		if (appState.sessionActive && feedback.messages?.length && now - appState.lastLiveCoachAt > 900) {
			renderLiveCoachTip(feedback.messages[0]);
			appState.lastLiveCoachAt = now;
		}
		if (isStableEnoughForCapture(prediction)) {
			registerValidSnapshot(buildSnapshot(prediction, feedback.messages, liveScore));
		}

		renderPrediction({
			label: prediction.label,
			confidence: prediction.confidence,
			score: liveScore,
			feedback: feedback.messages,
		});
	} catch (error) {
		renderStatus(`Prediction error: ${error.message}`);
	} finally {
		busyPredicting = false;
	}
}

async function startRealtimePipeline() {
	stopRealtimePipeline();
	resetAnalysisUI();
	appState.sessionActive = false;
	resetSessionState();
	appState.lastValidSnapshot = null;
	appState.bestSnapshot = null;
	appState.recentSnapshots = [];
	appState.stability.label = null;
	appState.stability.streak = 0;
	appState.lastMonitorTipAt = 0;
	appState.lastPoseReadyAt = 0;

	renderStatus('Loading classification model...');
	await predictor.load();

	renderStatus('Starting MoveNet webcam pipeline...');
	poseStream = new PoseStream({
		rawVideoEl,
		markedVideoEl,
		canvasEl,
		onPoseFrame,
	});

	await poseStream.start();
	renderStatus('Live analysis running. Hold Konasana posture in frame.');
}

async function handleGenerateReport() {
	if (!appState.sessionReport) {
		renderReport('No session report available. Click Start Session, practice, then End Session before generating report.');
		latestReportText = '';
		setDownloadReportState(false);
		return;
	}

	const source = appState.sessionReport;
	const consistency = source.totalFrames ? (source.correctFrameCount / source.totalFrames) * 100 : 0;
	const visibilityQuality = source.totalCapturedFrames
		? ((source.totalCapturedFrames - source.skippedFrameCount) / source.totalCapturedFrames) * 100
		: 0;
	const sessionFeedback = [
		`Session duration: ${source.sessionDuration}`,
		`Pose checks completed: ${source.totalFrames}`,
		`Consistency score: ${consistency.toFixed(1)}%`,
		`Visibility quality: ${visibilityQuality.toFixed(1)}%`,
		`Stable posture moments: ${source.correctFrameCount}`,
		`Needs-adjustment moments: ${source.moderateFrameCount + source.incorrectFrameCount}`,
		`Session final result: ${source.finalResult}`,
		`Session average score: ${source.averageScore.toFixed(2)} / 10`,
		`Improvements needed: ${(source.improvements || []).join(' | ')}`,
	];

	const reportData = {
		asana: source.asanaName,
		prediction: source.finalResult.toLowerCase(),
		score: source.averageScore,
		age: appState.userProfile.age,
		flexibility: appState.userProfile.flexibility,
		experience: appState.userProfile.experience,
		session: {
			duration: source.sessionDuration,
			totalCapturedFrames: source.totalCapturedFrames,
			totalAnalyzedFrames: source.totalFrames,
			skippedFrames: source.skippedFrameCount,
			correctFrames: source.correctFrameCount,
			moderateFrames: source.moderateFrameCount,
			incorrectFrames: source.incorrectFrameCount,
			finalResult: source.finalResult,
			averageScore: source.averageScore,
			improvements: source.improvements || [],
		},
		feedback: sessionFeedback,
	};

	renderReport('Generating report...');
	latestReportText = '';
	setDownloadReportState(false);
	try {
		const report = await generateYogaReport({
			data: reportData,
		});
		renderReport(report);
		latestReportText = report;
		setDownloadReportState(true);
	} catch (error) {
		renderReport(`Could not generate OpenRouter report: ${error.message}`);
		latestReportText = '';
		setDownloadReportState(false);
	}
}

initDashboard({
	onAsanaChanged: (asanaName) => {
		appState.asana = asanaName;
	},
	onStartSession: async () => {
		await startSession();
	},
	onEndSession: () => {
		endSession();
	},
	onGenerateReport: () => {
		handleGenerateReport();
	},
	onLogout: () => {
		logoutUser();
	},
});

initLogin({
	onLoginSuccess: ({ email, fullName }) => {
		appState.user = { email, fullName: fullName || '' };
		setWelcomeText(appState.user);
		renderStatus('Logged in successfully.');
	},
	onProfileSubmit: async (profile) => {
		appState.userProfile = profile;
		renderStatus('Profile saved. Click Start Session to begin webcam analysis.');
		try {
			await predictor.load();
		} catch (error) {
			renderStatus(`Model load failed: ${error.message}`);
		}
	},
});

if (downloadReportBtn) {
	downloadReportBtn.addEventListener('click', downloadReportAsText);
}

setDownloadReportState(false);

window.addEventListener('beforeunload', () => {
	stopRealtimePipeline();
});

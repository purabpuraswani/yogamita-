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
	showDashboardView,
	showReportView,
} from './dashboard.js';
import { PoseStream, estimateSideBendMagnitude } from './poseDetection.js';
import { PredictionEngine } from './prediction.js';
import { generateFeedback } from './feedback.js';
import { generateYogaReport } from './report.js';
import { processTemporalFramePipeline } from './temporalFrameProcessor.js';
import { getValidStepSequenceFrames, getMajorStepSegments, buildSessionScoresFromMajorSegments, ensureAllStepSkeletons } from './sessionScoringPipeline.js';
import { runEnhancedTemporalPipeline, buildTimingAnalysisFromSelectedFrames, validateAndGetAngles } from './enhancedTemporalPipeline.js';

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
	sessionProcessedFrameCount: 0,
	hasLoggedPoseDetected: false,
};

const rawVideoEl = document.getElementById('rawVideo');
const markedVideoEl = document.getElementById('markedVideo');
const canvasEl = document.getElementById('poseCanvas');
const downloadReportBtn = document.getElementById('downloadReportBtn');
const chatbotMessagesEl = document.getElementById('chatbotMessages');
const chatbotFormEl = document.getElementById('chatbotForm');
const chatbotInputEl = document.getElementById('chatbotInput');
const chatbotSendBtnEl = document.getElementById('chatbotSendBtn');
const reportAssistantToggleBtnEl = document.getElementById('reportAssistantToggle');
const reportAssistantPanelEl = document.getElementById('reportAssistantPanel');
const reportAssistantCloseBtnEl = document.getElementById('reportAssistantClose');
const reportLoadingStateEl = document.getElementById('reportLoadingState');
const reportLoadingTextEl = document.getElementById('reportLoadingText');
const sessionFeedbackModalEl = document.getElementById('sessionFeedbackModal');
const sessionFeedbackFormEl = document.getElementById('sessionFeedbackForm');
const feedbackDiscomfortEl = document.getElementById('feedbackDiscomfort');
const feedbackPainAreaWrapEl = document.getElementById('feedbackPainAreaWrap');
const feedbackPainAreaEl = document.getElementById('feedbackPainArea');
const feedbackPainIntensityWrapEl = document.getElementById('feedbackPainIntensityWrap');
const feedbackPainIntensityEl = document.getElementById('feedbackPainIntensity');
const feedbackSkipBtnEl = document.getElementById('feedbackSkipBtn');

let latestReportText = '';
const DEFAULT_CHATBOT_PLACEHOLDER = chatbotInputEl?.getAttribute('placeholder') || 'Ask your asana question...';
const DEFAULT_CHATBOT_SEND_LABEL = chatbotSendBtnEl?.textContent || 'Send';

const predictor = new PredictionEngine('/models');
let poseStream = null;
let busyPredicting = false;
let lastPredictionAt = 0;
let sessionActive = false;
let reportGenerationInProgress = false;
const STABLE_CAPTURE_FRAMES = 5;
const STABLE_CAPTURE_MIN_CONFIDENCE = 0.55;

// ================== KEYPOINT SMOOTHING (EMA) ==================
let previousSmoothedKeypoints = null;  // For EMA smoothing across frames
const EMA_ALPHA = 0.6;  // Exponential Moving Average smoothing factor
// ================================================================

// ================== FRAME PROCESSING THRESHOLDS (Far User) ==================
const KEYPOINT_CONFIDENCE_THRESHOLD = 0.4;  // Keypoint visibility threshold
const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.45;  // Model confidence threshold
const STABLE_MOVEMENT_THRESHOLD = 0.08;  // Movement threshold for stable frames
const MOVEMENT_SPIKE_THRESHOLD = 0.15;  // Movement spike to detect transitions
const ANGLE_SPIKE_THRESHOLD = 10;  // Angle change spike to detect transitions
const MIN_STABLE_SEGMENT_FRAMES = 6;  // Minimum consecutive stable frames
const MIN_STEP_SEGMENT_FRAMES = 6;  // Remove short consecutive step segments as noise
const STEP_SEQUENCE = ['step1', 'step2', 'step3'];
const STEP_SMOOTHING_WINDOW_SIZE = 5;
const STEP_STATE = {
	WAIT_STEP1: 'WAIT_STEP1',
	STEP1: 'STEP1',
	STEP2: 'STEP2',
	STEP3: 'STEP3',
	FINISHED: 'FINISHED',
};
const SESSION_HISTORY_KEY_PREFIX = 'yogmitra_session_history';
const SESSION_HISTORY_MAX = 100;
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
// =============================================================================

function setSessionActive(active) {
	sessionActive = Boolean(active);
	appState.sessionActive = sessionActive;
}

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

function appendChatMessage(role, text) {
	if (!chatbotMessagesEl || !text) {
		return;
	}

	const msgEl = document.createElement('div');
	msgEl.className = role === 'user' ? 'chat-msg chat-msg-user' : 'chat-msg chat-msg-bot';
	msgEl.textContent = text;
	chatbotMessagesEl.appendChild(msgEl);
	chatbotMessagesEl.scrollTop = chatbotMessagesEl.scrollHeight;
}

function getAsanaCatalogContext(asanaName) {
	const catalog = Array.isArray(window.__yogmitraAsanas) ? window.__yogmitraAsanas : [];
	const selected = catalog.find((item) => item?.name === asanaName) || null;
	if (!selected) {
		return null;
	}

	return {
		name: selected.name,
		description: selected.description || '',
		faqs: Array.isArray(selected.faqs) ? selected.faqs : [],
		anatomicalFocus: selected.anatomicalFocus || null,
		tutorialSteps: Array.isArray(selected.tutorialSteps)
			? selected.tutorialSteps.map((step) => ({ title: step.title, caption: step.caption }))
			: [],
	};
}

function toStorageSlug(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'unknown';
}

function buildSessionHistoryStorageKey(userEmail, asanaName) {
	return `${SESSION_HISTORY_KEY_PREFIX}_${toStorageSlug(userEmail)}_${toStorageSlug(asanaName)}`;
}

function readSessionHistory(userEmail, asanaName) {
	if (!userEmail || !asanaName) {
		return [];
	}

	const key = buildSessionHistoryStorageKey(userEmail, asanaName);
	try {
		const parsed = JSON.parse(localStorage.getItem(key) || '[]');
		return Array.isArray(parsed) ? parsed : [];
	} catch (_error) {
		return [];
	}
}

function toFixedOrNullForHistory(value, digits = 2) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null;
}

function buildCompactAngleSummary(angleAnalysis) {
	if (!angleAnalysis || typeof angleAnalysis !== 'object') {
		return null;
	}

	const stepKeys = ['step1', 'step2', 'step3'];
	const perStep = {};
	const topJointIssues = [];

	for (const stepKey of stepKeys) {
		const stepInfo = angleAnalysis?.steps?.[stepKey] || null;
		perStep[stepKey] = {
			averageError: toFixedOrNullForHistory(stepInfo?.averageError),
			performance: stepInfo?.performance || 'Unknown',
		};

		const worstJoint = (Array.isArray(stepInfo?.jointAnalysis) ? stepInfo.jointAnalysis : [])
			.filter((joint) => Number.isFinite(Number(joint?.angleError)))
			.sort((a, b) => Number(b.angleError) - Number(a.angleError))[0];

		if (worstJoint) {
			topJointIssues.push({
				step: stepKey,
				jointName: worstJoint.jointName || `joint_${Number(worstJoint.jointIndex) + 1}`,
				angleError: toFixedOrNullForHistory(worstJoint.angleError),
				classification: worstJoint.classification || 'Unknown',
			});
		}
	}

	return {
		overallAverageError: toFixedOrNullForHistory(angleAnalysis?.overallAverageError),
		overallPerformance: angleAnalysis?.overallPerformance || 'Unknown',
		perStep,
		topJointIssues,
	};
}

function buildAngleComparisonSummary(currentAngleSummary, previousAngleSummary) {
	if (!currentAngleSummary || !previousAngleSummary) {
		return null;
	}

	const safeSubtract = (curr, prev) => {
		const current = Number(curr);
		const previous = Number(prev);
		if (!Number.isFinite(current) || !Number.isFinite(previous)) {
			return null;
		}
		return Number((current - previous).toFixed(2));
	};

	const stepKeys = ['step1', 'step2', 'step3'];
	const perStep = {};
	for (const stepKey of stepKeys) {
		perStep[stepKey] = {
			errorDelta: safeSubtract(
				currentAngleSummary?.perStep?.[stepKey]?.averageError,
				previousAngleSummary?.perStep?.[stepKey]?.averageError,
			),
		};
	}

	return {
		overallErrorDelta: safeSubtract(
			currentAngleSummary?.overallAverageError,
			previousAngleSummary?.overallAverageError,
		),
		perStep,
	};
}

function buildSessionHistoryEntry(sessionReport) {
	if (!sessionReport) {
		return null;
	}

	return {
		endedAt: new Date().toISOString(),
		asanaName: sessionReport.asanaName,
		sessionDuration: sessionReport.sessionDuration,
		totalFrames: sessionReport.totalFrames,
		totalCapturedFrames: sessionReport.totalCapturedFrames,
		correctFrameCount: sessionReport.correctFrameCount,
		moderateFrameCount: sessionReport.moderateFrameCount,
		incorrectFrameCount: sessionReport.incorrectFrameCount,
		skippedFrameCount: sessionReport.skippedFrameCount,
		averageScore: sessionReport.averageScore,
		finalResult: sessionReport.finalResult,
		improvements: Array.isArray(sessionReport.improvements) ? sessionReport.improvements : [],
		angleSummary: buildCompactAngleSummary(sessionReport.angleAnalysis),
	};
}

function persistSessionHistoryEntry(sessionReport) {
	const userEmail = appState.user?.email;
	const asanaName = sessionReport?.asanaName || appState.asana;
	if (!userEmail || !asanaName || !sessionReport) {
		return null;
	}

	const key = buildSessionHistoryStorageKey(userEmail, asanaName);
	const existing = readSessionHistory(userEmail, asanaName);
	const nextEntry = buildSessionHistoryEntry(sessionReport);
	if (!nextEntry) {
		return null;
	}

	const updated = [...existing, nextEntry].slice(-SESSION_HISTORY_MAX);
	localStorage.setItem(key, JSON.stringify(updated));
	return nextEntry;
}

function updateLatestSessionFeedbackInHistory(feedbackPayload) {
	const userEmail = appState.user?.email;
	const asanaName = appState.sessionReport?.asanaName || appState.asana;
	if (!userEmail || !asanaName) {
		return false;
	}

	const key = buildSessionHistoryStorageKey(userEmail, asanaName);
	const existing = readSessionHistory(userEmail, asanaName);
	if (!existing.length) {
		return false;
	}

	const updated = [...existing];
	updated[updated.length - 1] = {
		...updated[updated.length - 1],
		userFeedback: feedbackPayload,
	};
	localStorage.setItem(key, JSON.stringify(updated));

	if (appState.sessionReport) {
		appState.sessionReport.userFeedback = feedbackPayload;
	}
	return true;
}

function summarizeSessionHistory(history) {
	const safeHistory = Array.isArray(history) ? history : [];
	const resultCounts = {
		Correct: 0,
		Moderate: 0,
		Incorrect: 0,
	};

	for (const item of safeHistory) {
		const result = String(item?.finalResult || '').trim();
		if (Object.prototype.hasOwnProperty.call(resultCounts, result)) {
			resultCounts[result] += 1;
		}
	}

	const latest = safeHistory.length ? safeHistory[safeHistory.length - 1] : null;
	const previousSession = safeHistory.length > 1 ? safeHistory[safeHistory.length - 2] : null;
	const angleComparison = buildAngleComparisonSummary(latest?.angleSummary, previousSession?.angleSummary);
	const recentFeedback = safeHistory
		.filter((entry) => entry?.userFeedback)
		.slice(-5)
		.map((entry) => ({
			endedAt: entry.endedAt,
			overallRating: entry.userFeedback.overallRating,
			difficulty: entry.userFeedback.difficulty,
			confidenceBeforeSession: entry.userFeedback.confidenceBeforeSession,
			confidenceAfterSession: entry.userFeedback.confidenceAfterSession,
			discomfortLevel: entry.userFeedback.discomfortLevel,
			painIntensity: entry.userFeedback.painIntensity,
			hardestStep: entry.userFeedback.hardestStep,
			correctionFocus: entry.userFeedback.correctionFocus,
			nextSessionGoal: entry.userFeedback.nextSessionGoal,
			mainChallenge: entry.userFeedback.mainChallenge,
			comment: entry.userFeedback.comment || '',
		}));

	return {
		totalSessions: safeHistory.length,
		resultCounts,
		latestSession: latest,
		previousSession,
		angleComparison,
		recentFeedback,
		recentSessions: safeHistory.slice(-5),
	};
}

function buildChatContext() {
	const session = appState.sessionReport || null;
	const userEmail = appState.user?.email || null;
	const asanaName = appState.asana;
	const sessionHistory = summarizeSessionHistory(readSessionHistory(userEmail, asanaName));
	const previousAngleSummary = sessionHistory?.previousSession?.angleSummary || null;
	const safeSession = session
		? {
			asanaName: session.asanaName,
			sessionDuration: session.sessionDuration,
			totalFrames: session.totalFrames,
			totalCapturedFrames: session.totalCapturedFrames,
			correctFrameCount: session.correctFrameCount,
			moderateFrameCount: session.moderateFrameCount,
			incorrectFrameCount: session.incorrectFrameCount,
			skippedFrameCount: session.skippedFrameCount,
			averageScore: session.averageScore,
			finalResult: session.finalResult,
			improvements: Array.isArray(session.improvements) ? session.improvements : [],
			timingAnalysis: session.timingAnalysis || null,
			angleAnalysis: session.angleAnalysis || null,
			angleSummary: buildCompactAngleSummary(session.angleAnalysis),
			userFeedback: session.userFeedback || null,
		}
		: null;
	const angleComparisonCurrentVsPrevious = buildAngleComparisonSummary(safeSession?.angleSummary, previousAngleSummary);

	return {
		user: appState.user
			? {
				email: appState.user.email,
				fullName: appState.user.fullName || '',
			}
			: null,
		userProfile: appState.userProfile || null,
		selectedAsana: appState.asana,
		asanaInfo: getAsanaCatalogContext(appState.asana),
		session: safeSession,
		sessionHistorySummary: sessionHistory,
		angleComparisonCurrentVsPrevious,
	};
}

function setFeedbackPainAreaVisibility(discomfortValue) {
	if (!feedbackPainAreaWrapEl) {
		return;
	}

	const needsPainArea = discomfortValue === 'mild' || discomfortValue === 'pain';
	feedbackPainAreaWrapEl.classList.toggle('hidden', !needsPainArea);
	if (feedbackPainAreaEl) {
		feedbackPainAreaEl.required = needsPainArea;
	}

	if (feedbackPainIntensityWrapEl) {
		feedbackPainIntensityWrapEl.classList.toggle('hidden', !needsPainArea);
	}

	if (feedbackPainIntensityEl) {
		feedbackPainIntensityEl.required = needsPainArea;
	}
}

function openSessionFeedbackModal() {
	if (!sessionFeedbackModalEl) {
		return;
	}

	sessionFeedbackModalEl.classList.remove('hidden');
	setFeedbackPainAreaVisibility(feedbackDiscomfortEl?.value || 'none');
}

function closeSessionFeedbackModal() {
	if (!sessionFeedbackModalEl) {
		return;
	}

	sessionFeedbackModalEl.classList.add('hidden');
}

function setReportGenerationLoading(isLoading, message = 'Generating your personalized report...') {
	if (reportLoadingStateEl) {
		reportLoadingStateEl.classList.toggle('hidden', !isLoading);
	}

	if (reportLoadingTextEl && message) {
		reportLoadingTextEl.textContent = message;
	}
}

function setReportAssistantOpen(isOpen) {
	if (reportAssistantPanelEl) {
		reportAssistantPanelEl.classList.toggle('hidden', !isOpen);
	}

	if (reportAssistantToggleBtnEl) {
		reportAssistantToggleBtnEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
	}
}

function setReportAssistantAvailable(isAvailable) {
	if (reportAssistantToggleBtnEl) {
		reportAssistantToggleBtnEl.classList.toggle('hidden', !isAvailable);
	}

	if (!isAvailable) {
		setReportAssistantOpen(false);
	}
}

function setChatbotInteractionEnabled(isEnabled) {
	if (chatbotInputEl) {
		chatbotInputEl.disabled = !isEnabled;
		chatbotInputEl.placeholder = isEnabled
			? DEFAULT_CHATBOT_PLACEHOLDER
			: 'Report is generating... chatbot will unlock automatically';
	}

	if (chatbotSendBtnEl) {
		chatbotSendBtnEl.disabled = !isEnabled;
		chatbotSendBtnEl.textContent = isEnabled ? DEFAULT_CHATBOT_SEND_LABEL : 'Locked';
	}
}

async function transitionToGeneratedReportPage() {
	if (reportGenerationInProgress) {
		return;
	}

	reportGenerationInProgress = true;
	showReportView();
	setReportAssistantAvailable(false);
	setReportGenerationLoading(true, 'Generating your report from latest session and feedback...');
	renderStatus('Generating your session report and opening report page...');

	try {
		await handleGenerateReport();
		renderStatus('Report generated. You can now ask personalized questions in chatbot.');
	} catch (error) {
		renderStatus(`Could not generate report automatically: ${error.message}`);
	} finally {
		setReportGenerationLoading(false);
		reportGenerationInProgress = false;
	}
}

function collectSessionFeedbackFromForm() {
	const getValue = (id, fallback = '') => {
		const el = document.getElementById(id);
		if (!el) return fallback;
		return String(el.value || fallback).trim();
	};

	const discomfortLevel = getValue('feedbackDiscomfort', 'none');
	const confidenceBeforeSession = Number(getValue('feedbackConfidenceBefore', '3'));
	const confidenceAfterSession = Number(getValue('feedbackConfidence', '3'));
	const feedbackPayload = {
		submittedAt: new Date().toISOString(),
		overallRating: Number(getValue('feedbackOverallRating', '4')),
		coachHelpfulness: Number(getValue('feedbackCoachHelpfulness', '4')),
		difficulty: getValue('feedbackDifficulty', 'moderate'),
		confidenceBeforeSession,
		confidenceAfterSession,
		confidenceDelta: Number.isFinite(confidenceAfterSession) && Number.isFinite(confidenceBeforeSession)
			? confidenceAfterSession - confidenceBeforeSession
			: null,
		discomfortLevel,
		painArea: (discomfortLevel === 'mild' || discomfortLevel === 'pain')
			? getValue('feedbackPainArea', 'other')
			: null,
		painIntensity: (discomfortLevel === 'mild' || discomfortLevel === 'pain')
			? Number(getValue('feedbackPainIntensity', '3'))
			: 0,
		hardestStep: getValue('feedbackHardestStep', 'step2'),
		correctionFocus: getValue('feedbackCorrectionFocus', 'spine_alignment'),
		mainChallenge: getValue('feedbackMainChallenge', 'holding_pose'),
		nextSessionGoal: getValue('feedbackNextSessionGoal', 'improve_accuracy'),
		comment: getValue('feedbackComment', ''),
	};

	return feedbackPayload;
}

async function handleSessionFeedbackSubmit(event) {
	event.preventDefault();
	const feedbackPayload = collectSessionFeedbackFromForm();
	const stored = updateLatestSessionFeedbackInHistory(feedbackPayload);

	closeSessionFeedbackModal();
	if (stored) {
		renderStatus('Thanks for your feedback. Chatbot memory updated for personalized coaching.');
	} else {
		renderStatus('Feedback received, but could not attach it to session history.');
	}

	await transitionToGeneratedReportPage();
}

async function handleSessionFeedbackSkip() {
	closeSessionFeedbackModal();
	renderStatus('Feedback skipped. Generating report from this completed session...');
	await transitionToGeneratedReportPage();
}

async function handleChatbotSubmit(event) {
	event.preventDefault();
	if (!chatbotInputEl) {
		return;
	}

	const question = chatbotInputEl.value.trim();
	if (!question) {
		return;
	}

	appendChatMessage('user', question);
	chatbotInputEl.value = '';
	if (chatbotInputEl) {
		chatbotInputEl.disabled = true;
	}
	if (chatbotSendBtnEl) {
		chatbotSendBtnEl.disabled = true;
		chatbotSendBtnEl.textContent = 'Thinking...';
	}

	try {
		const response = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				question,
				context: buildChatContext(),
			}),
		});

		if (!response.ok) {
			const message = await response.text();
			throw new Error(message || `Chat API failed with status ${response.status}`);
		}

		const result = await response.json();
		const reply = String(result?.reply || '').trim() || 'I could not generate a response. Please try again.';
		appendChatMessage('bot', reply);
	} catch (error) {
		appendChatMessage('bot', `I could not answer right now: ${error.message}`);
	} finally {
		if (chatbotInputEl) {
			chatbotInputEl.disabled = false;
			chatbotInputEl.focus();
		}
		if (chatbotSendBtnEl) {
			chatbotSendBtnEl.disabled = false;
			chatbotSendBtnEl.textContent = 'Send';
		}
	}
}

const KP = {
	LEFT_SHOULDER: 5,
	RIGHT_SHOULDER: 6,
	LEFT_WRIST: 9,
	RIGHT_WRIST: 10,
};

function getPoseVisibilityScore(pose) {
	if (!pose || !Array.isArray(pose.keypoints) || pose.keypoints.length < 17) {
		return 0;
	}

	const visibleCount = pose.keypoints.filter((kp) => (kp?.score ?? 0) >= 0.3).length;
	return visibleCount / 17;
}

// ================== KEYPOINT CONFIDENCE CALCULATION ==================
function getAverageKeypointConfidence(pose) {
	if (!pose || !Array.isArray(pose.keypoints) || pose.keypoints.length < 17) {
		return 0;
	}

	const scores = pose.keypoints.map((kp) => Number(kp?.score) || 0);
	const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
	return Math.min(1, Math.max(0, average));
}

// ==================== KEYPOINT SMOOTHING (EMA) ====================
// Smooth keypoints using Exponential Moving Average to reduce noise
// Formula: smoothedX = alpha * currentX + (1 - alpha) * previousX
function smoothKeypointsWithEMA(keypointFeatures) {
	if (!Array.isArray(keypointFeatures) || keypointFeatures.length < 34) {
		return keypointFeatures;
	}

	const smoothed = [...keypointFeatures];

	if (!previousSmoothedKeypoints || previousSmoothedKeypoints.length < 34) {
		previousSmoothedKeypoints = [...keypointFeatures];
		return smoothed;
	}

	// Apply EMA smoothing to each x, y coordinate pair
	for (let i = 0; i < 34; i += 1) {
		const current = Number(keypointFeatures[i]) || 0;
		const previous = Number(previousSmoothedKeypoints[i]) || 0;
		smoothed[i] = EMA_ALPHA * current + (1 - EMA_ALPHA) * previous;
	}

	previousSmoothedKeypoints = [...smoothed];
	return smoothed;
}

// ====================== MOVEMENT CALCULATION =======================
// Calculate average distance between keypoints of current and previous frame
// Movement represents how much the pose changed between frames
function calculateFrameMovement(currentKeypoints, previousKeypoints) {
	if (!Array.isArray(currentKeypoints) || !Array.isArray(previousKeypoints)) {
		return 0;
	}

	if (currentKeypoints.length < 34 || previousKeypoints.length < 34) {
		return 0;
	}

	let totalDistance = 0;
	let validKpCount = 0;

	// Calculate Euclidean distance for each keypoint (x, y pair)
	for (let i = 0; i < 17; i += 1) {
		const currX = Number(currentKeypoints[i * 2]) || 0;
		const currY = Number(currentKeypoints[(i * 2) + 1]) || 0;
		const prevX = Number(previousKeypoints[i * 2]) || 0;
		const prevY = Number(previousKeypoints[(i * 2) + 1]) || 0;

		const dx = currX - prevX;
		const dy = currY - prevY;
		const distance = Math.sqrt((dx * dx) + (dy * dy));

		totalDistance += distance;
		validKpCount += 1;
	}

	// Calculate average distance and normalize to [0, 1]
	const averageDistance = validKpCount > 0 ? totalDistance / validKpCount : 0;
	// Normalize: 0.3 is ~100% of video width for far user, cap at 1.0
	const normalizedMovement = Math.min(1, averageDistance / 0.3);

	return normalizedMovement;
}

// ================== STABILITY SCORE COMPUTATION ==================
// stabilityScore = (0.5 * confidence) + (0.3 * keypointConfidence) - (0.2 * movement)
function computeStabilityScore(confidence, keypointConfidence, movement) {
	const conf = Math.min(1, Math.max(0, Number(confidence) || 0));
	const kpConf = Math.min(1, Math.max(0, Number(keypointConfidence) || 0));
	const mv = Math.min(1, Math.max(0, Number(movement) || 0));
	
	const score = (0.5 * conf) + (0.3 * kpConf) - (0.2 * mv);
	return Math.min(1, Math.max(0, score));
}

// =================================================================

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
	appState.sessionProcessedFrameCount = 0;
	appState.hasLoggedPoseDetected = false;
}

function hasRecoverableSessionData() {
	return Boolean(
		appState.sessionStartTime ||
		appState.sessionPredictions.length ||
		appState.skippedFrameCount
	);
}

function recordSkippedSessionFrame() {
	if (!sessionActive) {
		return;
	}
	appState.skippedFrameCount += 1;
}

function recordSessionFrame(prediction, keypointFeatures = null, keypointConfidence = 0, previousKeypoints = null) {
	if (!sessionActive || !prediction?.label) {
		return;
	}

	// Calculate actual movement between this frame and previous frame
	let movement = 0;
	if (Array.isArray(keypointFeatures) && Array.isArray(previousKeypoints)) {
		movement = calculateFrameMovement(keypointFeatures, previousKeypoints);
	} else {
		movement = Number(prediction.movementFeature) || 0;
	}

	// Compute stability score using formula: (0.5 * confidence) + (0.3 * keypointConfidence) - (0.2 * movement)
	const modelConfidence = Number(prediction.confidence) || 0;
	const kpConf = Number(keypointConfidence) || 0;
	const stabilityScore = computeStabilityScore(modelConfidence, kpConf, movement);
	const angleValues = Array.isArray(prediction.jointAnglesDegrees)
		? prediction.jointAnglesDegrees.map((value) => Number(value) || 0)
		: (Array.isArray(prediction.jointAngleFeatures)
			? prediction.jointAngleFeatures.map((value) => {
				const numeric = Number(value) || 0;
				return numeric <= 1.000001 ? numeric * 180 : numeric;
			})
			: []);

	const frameRecord = {
		timestamp: prediction.timestamp || Date.now(),
		step: prediction.step || 'step1',
		label: prediction.label,
		confidence: modelConfidence,
		keypointConfidence: kpConf,
		movement: movement,
		stabilityScore: stabilityScore,
		keypoints: Array.isArray(keypointFeatures)
			? [...keypointFeatures]
			: (Array.isArray(prediction.inputVector) ? prediction.inputVector.slice(0, 34) : []),
		angles: angleValues,
		angleOrder: JOINT_ANGLE_ORDER,
	};

	appState.sessionPredictions.push(frameRecord);

	// Track counts for scoring
	const frameScore = getAdjustedFrameScore(prediction.label, appState.userProfile?.age);
	appState.sessionScores.push(frameScore);

	if (prediction.label === 'correct') {
		appState.correctCount += 1;
	} else if (prediction.label === 'moderate') {
		appState.moderateCount += 1;
	} else {
		appState.incorrectCount += 1;
	}
}

function trimSessionFrameHistory(frameHistory) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		console.log('Trim applied: no (empty input)');
		console.log('Frames trimmed from 0 to 0');
		return [];
	}

	const firstStep1Index = frameHistory.findIndex((frame) => frame?.step === 'step1');
	let lastStep3Index = -1;
	for (let i = frameHistory.length - 1; i >= 0; i -= 1) {
		if (frameHistory[i]?.step === 'step3') {
			lastStep3Index = i;
			break;
		}
	}

	if (firstStep1Index === -1 || lastStep3Index === -1 || firstStep1Index > lastStep3Index) {
		console.log('Trim applied: no (fallback to full session frames)');
		console.log(`Frames trimmed from ${frameHistory.length} to ${frameHistory.length}`);
		return [...frameHistory];
	}

	const trimmed = frameHistory.slice(firstStep1Index, lastStep3Index + 1);
	console.log('Trim applied: yes');
	console.log(`Frames trimmed from ${frameHistory.length} to ${trimmed.length}`);
	return trimmed.length ? trimmed : [...frameHistory];
}

// Enforce allowed step transition order: step1 -> step2 -> step3.
function enforceStepOrder(frameHistory) {
	if (!Array.isArray(frameHistory) || !frameHistory.length) {
		return [];
	}

	let maxStepIndexSeen = -1;
	const orderedFrames = [];

	for (const frame of frameHistory) {
		const frameStep = frame?.step;
		const stepIndex = STEP_SEQUENCE.indexOf(frameStep);
		if (stepIndex === -1) {
			continue;
		}

		if (maxStepIndexSeen === -1) {
			if (stepIndex !== 0) {
				continue;
			}
			maxStepIndexSeen = 0;
			orderedFrames.push(frame);
			continue;
		}

		if (stepIndex < maxStepIndexSeen || stepIndex > maxStepIndexSeen + 1) {
			continue;
		}

		maxStepIndexSeen = Math.max(maxStepIndexSeen, stepIndex);
		orderedFrames.push(frame);
	}

	return orderedFrames;
}

// Explicit state machine:
// WAIT_STEP1 -> STEP1 -> STEP2 -> STEP3 -> FINISHED
function enforceStepOrderStateMachine(frameHistory) {
	if (!Array.isArray(frameHistory) || !frameHistory.length) {
		return [];
	}

	let state = STEP_STATE.WAIT_STEP1;
	const accepted = [];

	for (const frame of frameHistory) {
		const step = frame?.step;
		if (!STEP_SEQUENCE.includes(step)) {
			continue;
		}

		if (state === STEP_STATE.WAIT_STEP1) {
			if (step === 'step1') {
				accepted.push(frame);
				state = STEP_STATE.STEP1;
			}
			continue;
		}

		if (state === STEP_STATE.STEP1) {
			if (step === 'step1') {
				accepted.push(frame);
				continue;
			}
			if (step === 'step2') {
				accepted.push(frame);
				state = STEP_STATE.STEP2;
			}
			continue;
		}

		if (state === STEP_STATE.STEP2) {
			if (step === 'step2') {
				accepted.push(frame);
				continue;
			}
			if (step === 'step3') {
				accepted.push(frame);
				state = STEP_STATE.STEP3;
			}
			continue;
		}

		if (state === STEP_STATE.STEP3 || state === STEP_STATE.FINISHED) {
			if (step === 'step3') {
				accepted.push(frame);
				state = STEP_STATE.FINISHED;
			}
		}
	}

	return accepted;
}

function segmentConsecutiveStepLabels(frameHistory) {
	if (!Array.isArray(frameHistory) || !frameHistory.length) {
		return [];
	}

	const segments = [];
	let currentStep = frameHistory[0]?.step;
	let currentFrames = [];

	for (const frame of frameHistory) {
		const frameStep = frame?.step;
		if (!frameStep) {
			continue;
		}

		if (!currentFrames.length) {
			currentStep = frameStep;
			currentFrames = [frame];
			continue;
		}

		if (frameStep === currentStep) {
			currentFrames.push(frame);
			continue;
		}

		segments.push({ step: currentStep, frames: currentFrames });
		currentStep = frameStep;
		currentFrames = [frame];
	}

	if (currentFrames.length) {
		segments.push({ step: currentStep, frames: currentFrames });
	}

	return segments;
}

function removeVeryShortSegments(stepSegments) {
	if (!Array.isArray(stepSegments) || !stepSegments.length) {
		return [];
	}

	return stepSegments.filter((segment) => (segment?.frames?.length || 0) >= MIN_STEP_SEGMENT_FRAMES);
}

function flattenStepSegments(stepSegments) {
	if (!Array.isArray(stepSegments) || !stepSegments.length) {
		return [];
	}

	return stepSegments.flatMap((segment) => Array.isArray(segment?.frames) ? segment.frames : []);
}

function buildOrderedSessionFrameHistory(frameHistory) {
	if (!Array.isArray(frameHistory) || !frameHistory.length) {
		return [];
	}

	const smoothedFrames = smoothStepLabels(frameHistory, STEP_SMOOTHING_WINDOW_SIZE);
	const orderedFrames = enforceStepOrderStateMachine(smoothedFrames);
	const consecutiveSegments = segmentConsecutiveStepLabels(orderedFrames);
	const denoisedSegments = removeVeryShortSegments(consecutiveSegments);
	const denoisedFrames = flattenStepSegments(denoisedSegments);

	console.log('Step order enforcement:', {
		inputFrames: frameHistory.length,
		smoothedFrames: smoothedFrames.length,
		orderedFrames: orderedFrames.length,
		consecutiveSegments: consecutiveSegments.length,
		denoisedSegments: denoisedSegments.length,
		outputFrames: denoisedFrames.length,
	});

	if (denoisedFrames.length) {
		return denoisedFrames;
	}

	if (orderedFrames.length) {
		return orderedFrames;
	}

	return [...frameHistory];
}

function summarizeFrameLabels(frames) {
	const summary = {
		correct: 0,
		moderate: 0,
		incorrect: 0,
	};

	for (const frame of frames) {
		if (frame?.label === 'correct') {
			summary.correct += 1;
		} else if (frame?.label === 'moderate') {
			summary.moderate += 1;
		} else if (frame?.label === 'incorrect') {
			summary.incorrect += 1;
		}
	}

	return summary;
}

function pickBestFrameForStep(frames, stepKey) {
	const stepFrames = frames.filter((frame) => frame?.step === stepKey);
	if (!stepFrames.length) {
		return null;
	}

	return stepFrames.reduce((best, current) => {
		const bestScore = (Number(best.confidence) || 0) - (Number(best.movement) || 0);
		const currentScore = (Number(current.confidence) || 0) - (Number(current.movement) || 0);
		return currentScore > bestScore ? current : best;
	});
}

function pickBestStabilityFrame(frames) {
	if (!Array.isArray(frames) || !frames.length) {
		return null;
	}

	return frames.reduce((best, current) => {
		const bestScore = (Number(best?.confidence) || 0) - (Number(best?.movement) || 0);
		const currentScore = (Number(current?.confidence) || 0) - (Number(current?.movement) || 0);
		return currentScore > bestScore ? current : best;
	});
}

function selectStableWindowFrame(stepFrames) {
	if (!Array.isArray(stepFrames) || !stepFrames.length) {
		return null;
	}

	const stableSegments = [];
	let currentSegment = [];
	for (const frame of stepFrames) {
		const isStable = (Number(frame?.movement) || 0) < STABLE_MOVEMENT_THRESHOLD && 
		                 (Number(frame?.keypointConfidence) || 0) > KEYPOINT_CONFIDENCE_THRESHOLD;
		if (isStable) {
			currentSegment.push(frame);
			continue;
		}

		if (currentSegment.length) {
			stableSegments.push(currentSegment);
			currentSegment = [];
		}
	}
	if (currentSegment.length) {
		stableSegments.push(currentSegment);
	}

	if (!stableSegments.length) {
		return pickBestStabilityFrame(stepFrames);
	}

	const longestSegment = stableSegments.reduce((best, segment) => {
		if (!best || segment.length > best.length) {
			return segment;
		}
		if (segment.length < best.length) {
			return best;
		}

		const bestAvg = best.reduce((sum, frame) => sum + (Number(frame?.stabilityScore) || 0), 0) / best.length;
		const segmentAvg = segment.reduce((sum, frame) => sum + (Number(frame?.stabilityScore) || 0), 0) / segment.length;
		return segmentAvg > bestAvg ? segment : best;
	}, null);

	if (!longestSegment || !longestSegment.length) {
		return pickBestStabilityFrame(stepFrames);
	}

	const middleIndex = Math.floor((longestSegment.length - 1) / 2);
	return longestSegment[middleIndex];
}

// ================== STEP WINDOW SEGMENTATION ==================
function segmentFramesByStep(frameHistory) {
	if (!Array.isArray(frameHistory) || !frameHistory.length) {
		return {
			step1Window: [],
			step2Window: [],
			step3Window: [],
		};
	}

	const step1Window = [];
	const step2Window = [];
	const step3Window = [];

	for (let i = 0; i < frameHistory.length; i += 1) {
		const frame = frameHistory[i];
		const frameStep = frame?.step;

		// Assign to appropriate window
		if (frameStep === 'step1') {
			step1Window.push(frame);
		} else if (frameStep === 'step2') {
			step2Window.push(frame);
		} else if (frameStep === 'step3') {
			step3Window.push(frame);
		}
	}

	return { step1Window, step2Window, step3Window };
}

// Detect movement spike (indicates transition or relaxation)
function hasMovementSpike(frame, previousFrame) {
	if (!previousFrame) {
		return false;
	}

	const prevMovement = Number(previousFrame.movement) || 0;
	const currMovement = Number(frame.movement) || 0;
	const spike = Math.abs(currMovement - prevMovement);

	return spike > MOVEMENT_SPIKE_THRESHOLD;
}

// Detect angle spike (indicates transition or relaxation)
function hasAngleSpike(frame, previousFrame) {
	if (!previousFrame || !Array.isArray(frame.angles) || !Array.isArray(previousFrame.angles)) {
		return false;
	}

	const minLength = Math.min(frame.angles.length, previousFrame.angles.length);
	if (minLength < 3) {
		return false;
	}

	for (let i = 0; i < minLength; i += 1) {
		const prevAngle = Number(previousFrame.angles[i]) || 0;
		const currAngle = Number(frame.angles[i]) || 0;
		const angleDiff = Math.abs(currAngle - prevAngle);

		if (angleDiff > ANGLE_SPIKE_THRESHOLD) {
			return true;
		}
	}

	return false;
}

// Trim step3 window to exclude relaxation frames
function trimStep3Window(step3Frames) {
	if (!Array.isArray(step3Frames) || step3Frames.length < 2) {
		return step3Frames;
	}

	let lastValidIndex = step3Frames.length - 1;

	// Scan backwards to find where relaxation starts (movement/angle spike)
	for (let i = step3Frames.length - 2; i >= 0; i -= 1) {
		if (hasMovementSpike(step3Frames[i + 1], step3Frames[i]) || 
		    hasAngleSpike(step3Frames[i + 1], step3Frames[i])) {
			lastValidIndex = i;
			break;
		}
	}

	return step3Frames.slice(0, lastValidIndex + 1);
}

// ================== MAJORITY VOTING FOR STEP LABELS ==================
function getMajorityStepLabel(stepFrames) {
	if (!Array.isArray(stepFrames) || !stepFrames.length) {
		return null;
	}

	const labelCounts = {
		correct: 0,
		moderate: 0,
		incorrect: 0,
	};

	for (const frame of stepFrames) {
		const label = frame?.label;
		if (label && labelCounts.hasOwnProperty(label)) {
			labelCounts[label] += 1;
		}
	}

	const maxCount = Math.max(labelCounts.correct, labelCounts.moderate, labelCounts.incorrect);
	if (maxCount === 0) {
		return null;
	}

	// Return the most frequent label
	if (labelCounts.correct === maxCount) {
		return 'correct';
	}
	if (labelCounts.moderate === maxCount) {
		return 'moderate';
	}
	return 'incorrect';
}

function getMajorityStepValue(stepValues, fallback = null) {
	if (!Array.isArray(stepValues) || !stepValues.length) {
		return fallback;
	}

	const stepCounts = {
		step1: 0,
		step2: 0,
		step3: 0,
	};

	for (const step of stepValues) {
		if (stepCounts.hasOwnProperty(step)) {
			stepCounts[step] += 1;
		}
	}

	const maxCount = Math.max(stepCounts.step1, stepCounts.step2, stepCounts.step3);
	if (maxCount === 0) {
		return fallback;
	}

	if (stepCounts[fallback] === maxCount) {
		return fallback;
	}

	if (stepCounts.step1 === maxCount) {
		return 'step1';
	}
	if (stepCounts.step2 === maxCount) {
		return 'step2';
	}
	return 'step3';
}

function smoothStepLabels(frameHistory, windowSize = STEP_SMOOTHING_WINDOW_SIZE) {
	if (!Array.isArray(frameHistory) || !frameHistory.length) {
		return [];
	}

	const radius = Math.floor(Math.max(1, windowSize) / 2);
	const smoothed = frameHistory.map((frame, index) => {
		const start = Math.max(0, index - radius);
		const end = Math.min(frameHistory.length - 1, index + radius);
		const neighborhood = [];

		for (let i = start; i <= end; i += 1) {
			const value = frameHistory[i]?.step;
			if (value === 'step1' || value === 'step2' || value === 'step3') {
				neighborhood.push(value);
			}
		}

		const currentStep = frame?.step;
		const smoothedStep = getMajorityStepValue(neighborhood, currentStep);
		return {
			...frame,
			step: smoothedStep || currentStep,
		};
	});

	return smoothed;
}

function buildConsecutiveStepSegments(frameHistory) {
	if (!Array.isArray(frameHistory) || !frameHistory.length) {
		return [];
	}

	const segments = [];
	let activeStep = frameHistory[0]?.step;
	let activeFrames = [];

	for (const frame of frameHistory) {
		const frameStep = frame?.step;
		if (!frameStep) {
			continue;
		}

		if (!activeFrames.length) {
			activeStep = frameStep;
			activeFrames = [frame];
			continue;
		}

		if (frameStep === activeStep) {
			activeFrames.push(frame);
			continue;
		}

		segments.push({ step: activeStep, frames: activeFrames });
		activeStep = frameStep;
		activeFrames = [frame];
	}

	if (activeFrames.length) {
		segments.push({ step: activeStep, frames: activeFrames });
	}

	return segments;
}

function keepOnlyMainStepSegments(stepSegments) {
	if (!Array.isArray(stepSegments) || !stepSegments.length) {
		return {
			step1: [],
			step2: [],
			step3: [],
			validSegments: [],
		};
	}

	const validSegments = stepSegments.filter((segment) => {
		const isValidStep = STEP_SEQUENCE.includes(segment?.step);
		const segmentLength = segment?.frames?.length || 0;
		return isValidStep && segmentLength >= MIN_STEP_SEGMENT_FRAMES;
	});

	const pickMain = (stepKey) => {
		const candidates = validSegments.filter((segment) => segment.step === stepKey);
		if (!candidates.length) {
			return [];
		}

		const best = candidates.reduce((winner, segment) => {
			if (!winner) {
				return segment;
			}

			if (segment.frames.length > winner.frames.length) {
				return segment;
			}

			if (segment.frames.length < winner.frames.length) {
				return winner;
			}

			const winnerAvgStability = winner.frames.reduce((sum, frame) => sum + (Number(frame?.stabilityScore) || 0), 0) / winner.frames.length;
			const segmentAvgStability = segment.frames.reduce((sum, frame) => sum + (Number(frame?.stabilityScore) || 0), 0) / segment.frames.length;
			return segmentAvgStability > winnerAvgStability ? segment : winner;
		}, null);

		return best?.frames || [];
	};

	return {
		step1: pickMain('step1'),
		step2: pickMain('step2'),
		step3: pickMain('step3'),
		validSegments,
	};
}

function pickHighestStabilityFrame(frames) {
	if (!Array.isArray(frames) || !frames.length) {
		return null;
	}

	return frames.reduce((best, frame) => {
		const bestScore = Number(best?.stabilityScore) || 0;
		const currentScore = Number(frame?.stabilityScore) || 0;
		return currentScore > bestScore ? frame : best;
	}, null);
}

// ====================================================================

// ================== STABLE SEGMENT DETECTION =====================
// Detect consecutive stable frames within a step window
// A frame is stable if: movement < 0.08
// Only keep segments with length >= 6 frames
function detectStableSegments(stepFrames) {
	if (!Array.isArray(stepFrames) || !stepFrames.length) {
		return [];
	}

	const stableSegments = [];
	let currentSegment = [];

	for (const frame of stepFrames) {
		const isStable = (Number(frame?.movement) || 0) < STABLE_MOVEMENT_THRESHOLD;

		if (isStable) {
			currentSegment.push(frame);
		} else {
			// End of stable segment
			if (currentSegment.length >= MIN_STABLE_SEGMENT_FRAMES) {
				stableSegments.push([...currentSegment]);
			}
			currentSegment = [];
		}
	}

	// Don't forget last segment
	if (currentSegment.length >= MIN_STABLE_SEGMENT_FRAMES) {
		stableSegments.push([...currentSegment]);
	}

	return stableSegments;
}

// Select significant frame from longest stable segment
// Returns: { frame, segment, majorityLabel }
function selectFrameFromStableSegments(stepFrames) {
	const stableSegments = detectStableSegments(stepFrames);

	if (!stableSegments.length) {
		console.log(`No stable segment found (min ${MIN_STABLE_SEGMENT_FRAMES} frames required)`);
		return { frame: null, segment: null, majorityLabel: null };
	}

	// Find longest stable segment
	const longestSegment = stableSegments.reduce((longest, segment) => {
		if (!longest || segment.length > longest.length) {
			return segment;
		}
		// Tiebreaker: use average stability score
		if (segment.length === longest.length) {
			const longAvg = longest.reduce((sum, f) => sum + (Number(f.stabilityScore) || 0), 0) / longest.length;
			const segAvg = segment.reduce((sum, f) => sum + (Number(f.stabilityScore) || 0), 0) / segment.length;
			return segAvg > longAvg ? segment : longest;
		}
		return longest;
	}, null);

	if (!longestSegment || !longestSegment.length) {
		return { frame: null, segment: null, majorityLabel: null };
	}

	// Select middle frame from the segment
	const middleIndex = Math.floor((longestSegment.length - 1) / 2);
	const selectedFrame = longestSegment[middleIndex];

	// Compute majority label from all frames in segment
	const majorityLabel = getMajorityStepLabel(longestSegment);

	console.log(`Stable segment: ${longestSegment.length} frames, selected middle frame at index ${middleIndex}`);
	console.log(`Segment stability avg: ${(longestSegment.reduce((sum, f) => sum + (Number(f.stabilityScore) || 0), 0) / longestSegment.length).toFixed(3)}`);

	return { frame: selectedFrame, segment: longestSegment, majorityLabel };
}

// ===================================================================

// ================== NEW TEMPORAL FRAME PROCESSOR INTEGRATION ==================
/**
 * selectSignificantFramesWithTemporalProcessing
 * 
 * NEW PIPELINE: Uses temporalFrameProcessor to detect activity window and select
 * frames based on stability analysis, yielding more reliable significant frames
 * while avoiding transition/idle/relaxation frames.
 * 
 * Maintains API compatibility with the original selectSignificantFrames function
 */
function selectSignificantFramesWithTemporalProcessing(frameHistory) {
	if (!Array.isArray(frameHistory) || frameHistory.length === 0) {
		return {
			step1: null,
			step2: null,
			step3: null,
			worstFrame: null,
			finalFrame: null,
			step1MajorityLabel: null,
			step2MajorityLabel: null,
			step3MajorityLabel: null,
		};
	}

	// Run the new temporal pipeline
	const pipelineResult = processTemporalFramePipeline(frameHistory);
	
	// Extract frames and labels from pipeline
	const step1Frame = pipelineResult.step1;
	const step2Frame = pipelineResult.step2;
	const step3Frame = pipelineResult.step3;

	// Compute majority labels from the full frame history for consistency
	const step1Frames = frameHistory.filter((f) => f?.step === 'step1');
	const step2Frames = frameHistory.filter((f) => f?.step === 'step2');
	const step3Frames = frameHistory.filter((f) => f?.step === 'step3');

	const step1MajorityLabel = getMajorityStepLabel(step1Frames);
	const step2MajorityLabel = getMajorityStepLabel(step2Frames);
	const step3MajorityLabel = getMajorityStepLabel(step3Frames);

	// Find worst and final frames for reporting
	const incorrectFrames = frameHistory.filter((frame) => frame?.label === 'incorrect');
	const worstFrame = incorrectFrames.length
		? incorrectFrames.reduce((worst, current) => {
			const worstConfidence = Number(worst.confidence) || 0;
			const currentConfidence = Number(current.confidence) || 0;
			return currentConfidence < worstConfidence ? current : worst;
		})
		: null;

	const finalFrame = frameHistory[frameHistory.length - 1] || null;

	// Log the pipeline results
	console.log('=== TEMPORAL FRAME PROCESSOR INTEGRATION ===');
	console.log('Pipeline Results:', {
		step1Selected: step1Frame !== null,
		step2Selected: step2Frame !== null,
		step3Selected: step3Frame !== null,
		selectionMethods: pipelineResult.selectionMethods,
		effectiveConfidences: pipelineResult.effectiveConfidence,
	});
	console.log('Debug Log:', pipelineResult.debugLog);
	console.log('=== END TEMPORAL INTEGRATION ===');

	return {
		step1: step1Frame,
		step2: step2Frame,
		step3: step3Frame,
		worstFrame: worstFrame,
		finalFrame: finalFrame,
		step1MajorityLabel,
		step2MajorityLabel,
		step3MajorityLabel,
		pipelineDebug: pipelineResult.debugLog,
		averagePoses: pipelineResult.averagePose,
		effectiveConfidences: pipelineResult.effectiveConfidence,
	};
}
// =============================================================================

function selectSignificantFrames(trimmedFrameHistory) {
	if (!Array.isArray(trimmedFrameHistory) || trimmedFrameHistory.length === 0) {
		return {
			step1: null,
			step2: null,
			step3: null,
			worstFrame: null,
			finalFrame: null,
		};
	}

	const smoothedStepFrames = smoothStepLabels(trimmedFrameHistory, STEP_SMOOTHING_WINDOW_SIZE);
	const orderedStepFrames = enforceStepOrderStateMachine(smoothedStepFrames);
	const stepSegments = buildConsecutiveStepSegments(orderedStepFrames);
	const mainSegments = keepOnlyMainStepSegments(stepSegments);

	const step1Window = mainSegments.step1;
	const step2Window = mainSegments.step2;
	const step3Window = mainSegments.step3;

	// Trim step3 window to exclude relaxation frames
	const trimmedStep3Window = trimStep3Window(step3Window);

	console.log('=== STABLE SEGMENT DETECTION ===');
	console.log(`Smoothed step frames: ${smoothedStepFrames.length}`);
	console.log(`Ordered step frames (state machine): ${orderedStepFrames.length}`);
	console.log(`Consecutive step segments: ${stepSegments.length}, valid segments (>=${MIN_STEP_SEGMENT_FRAMES}): ${mainSegments.validSegments.length}`);
	console.log(`Step1 window: ${step1Window.length} frames`);
	const step1Result = selectFrameFromStableSegments(step1Window);
	const step1 = step1Result.frame || pickHighestStabilityFrame(step1Window) || pickBestFrameForStep(trimmedFrameHistory, 'step1') || trimmedFrameHistory[0] || null;
	const step1MajorityLabel = step1Result.majorityLabel || getMajorityStepLabel(step1Window);

	console.log(`Step2 window: ${step2Window.length} frames`);
	const step2Result = selectFrameFromStableSegments(step2Window);
	const step2 = step2Result.frame || pickHighestStabilityFrame(step2Window) || pickBestFrameForStep(trimmedFrameHistory, 'step2') || trimmedFrameHistory[0] || null;
	const step2MajorityLabel = step2Result.majorityLabel || getMajorityStepLabel(step2Window);

	console.log(`Step3 window: ${trimmedStep3Window.length} frames (trimmed from ${step3Window.length})`);
	const step3Result = selectFrameFromStableSegments(trimmedStep3Window);
	const step3 = step3Result.frame || pickHighestStabilityFrame(trimmedStep3Window) || pickBestFrameForStep(trimmedFrameHistory, 'step3') || trimmedFrameHistory[trimmedFrameHistory.length - 1] || null;
	const step3MajorityLabel = step3Result.majorityLabel || getMajorityStepLabel(trimmedStep3Window);

	console.log('Step Majority Labels:', {
		step1: step1MajorityLabel,
		step2: step2MajorityLabel,
		step3: step3MajorityLabel,
	});

	// Find worst frame (lowest confidence incorrect frame)
	const incorrectFrames = trimmedFrameHistory.filter((frame) => frame?.label === 'incorrect');
	const worstFrame = incorrectFrames.length
		? incorrectFrames.reduce((worst, current) => {
			const worstConfidence = Number(worst.confidence) || 0;
			const currentConfidence = Number(current.confidence) || 0;
			return currentConfidence < worstConfidence ? current : worst;
		})
		: null;

	const finalFrame = trimmedFrameHistory[trimmedFrameHistory.length - 1] || null;
	const fallbackWorst = trimmedFrameHistory.reduce((worst, current) => {
		if (!worst) {
			return current;
		}
		const worstConfidence = Number(worst.confidence) || 0;
		const currentConfidence = Number(current.confidence) || 0;
		return currentConfidence < worstConfidence ? current : worst;
	}, null);

	// Generate selected frame summary with enhanced metrics
	const selectedFrameSummary = {
		step1: step1
			? {
				timestamp: step1.timestamp,
				confidence: Number(step1.confidence) || 0,
				keypointConfidence: Number(step1.keypointConfidence) || 0,
				movement: Number(step1.movement) || 0,
				stabilityScore: Number(step1.stabilityScore) || 0,
				label: step1.label,
				majorityLabel: step1MajorityLabel,
				segmentLength: step1Result.segment ? step1Result.segment.length : null,
			}
			: null,
		step2: step2
			? {
				timestamp: step2.timestamp,
				confidence: Number(step2.confidence) || 0,
				keypointConfidence: Number(step2.keypointConfidence) || 0,
				movement: Number(step2.movement) || 0,
				stabilityScore: Number(step2.stabilityScore) || 0,
				label: step2.label,
				majorityLabel: step2MajorityLabel,
				segmentLength: step2Result.segment ? step2Result.segment.length : null,
			}
			: null,
		step3: step3
			? {
				timestamp: step3.timestamp,
				confidence: Number(step3.confidence) || 0,
				keypointConfidence: Number(step3.keypointConfidence) || 0,
				movement: Number(step3.movement) || 0,
				stabilityScore: Number(step3.stabilityScore) || 0,
				label: step3.label,
				majorityLabel: step3MajorityLabel,
				segmentLength: step3Result.segment ? step3Result.segment.length : null,
			}
			: null,
	};
	console.log('Selected Significant Frames (stable segment midpoints):', selectedFrameSummary);
	console.log('=== END STABLE SEGMENT DETECTION ===');

	return {
		step1,
		step2,
		step3,
		worstFrame: worstFrame || fallbackWorst,
		finalFrame,
		step1MajorityLabel,
		step2MajorityLabel,
		step3MajorityLabel,
	};
}

async function loadIdealPoseReference() {
	try {
		const response = await fetch('/ideal_pose_data.json', { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const payload = await response.json();
		return {
			step1: {
				idealAngles: Array.isArray(payload?.step1?.idealAngles) ? payload.step1.idealAngles.map(Number) : [],
				idealTime: Number(payload?.step1?.idealTime),
			},
			step2: {
				idealAngles: Array.isArray(payload?.step2?.idealAngles) ? payload.step2.idealAngles.map(Number) : [],
				idealTime: Number(payload?.step2?.idealTime),
			},
			step3: {
				idealAngles: Array.isArray(payload?.step3?.idealAngles) ? payload.step3.idealAngles.map(Number) : [],
				idealTime: Number(payload?.step3?.idealTime),
			},
			idealStep1Time: Number(payload?.step1?.idealTime),
			idealStep2Time: Number(payload?.step2?.idealTime),
			idealStep3Time: Number(payload?.step3?.idealTime),
		};
	} catch (error) {
		console.warn('Could not load ideal pose reference from ideal_pose_data.json', error);
		return {
			step1: {
				idealAngles: [],
				idealTime: null,
			},
			step2: {
				idealAngles: [],
				idealTime: null,
			},
			step3: {
				idealAngles: [],
				idealTime: null,
			},
			idealStep1Time: null,
			idealStep2Time: null,
			idealStep3Time: null,
		};
	}
}

function firstStepTimestamp(frameHistory, stepKey) {
	const frame = frameHistory.find((item) => item?.step === stepKey && Number.isFinite(item?.timestamp));
	return frame ? Number(frame.timestamp) : null;
}

function toSessionSeconds(timestampMs, sessionStartMs) {
	if (!Number.isFinite(timestampMs) || !Number.isFinite(sessionStartMs)) {
		return null;
	}
	return Math.max(0, (timestampMs - sessionStartMs) / 1000);
}

function toDegreesMaybeNormalized(values) {
	if (!Array.isArray(values)) {
		return [];
	}

	return values.map((value) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) {
			return NaN;
		}
		return numeric <= 1.000001 ? numeric * 180 : numeric;
	});
}

function subtractOrNull(a, b) {
	if (!Number.isFinite(a) || !Number.isFinite(b)) {
		return null;
	}
	return a - b;
}

function buildTimingAnalysis({ trimmedFrameHistory, sessionStartTime, sessionDurationMs, idealStepTimes }) {
	const userStep1TimestampMs = firstStepTimestamp(trimmedFrameHistory, 'step1');
	const userStep2TimestampMs = firstStepTimestamp(trimmedFrameHistory, 'step2');
	const userStep3TimestampMs = firstStepTimestamp(trimmedFrameHistory, 'step3');
	const timingReferenceStartMs = Number.isFinite(userStep1TimestampMs)
		? userStep1TimestampMs
		: sessionStartTime;

	const userStep1Time = toSessionSeconds(userStep1TimestampMs, timingReferenceStartMs);
	const userStep2Time = toSessionSeconds(userStep2TimestampMs, timingReferenceStartMs);
	const userStep3Time = toSessionSeconds(userStep3TimestampMs, timingReferenceStartMs);

	const idealStep1Time = Number.isFinite(idealStepTimes.idealStep1Time) ? idealStepTimes.idealStep1Time : null;
	const idealStep2Time = Number.isFinite(idealStepTimes.idealStep2Time) ? idealStepTimes.idealStep2Time : null;
	const idealStep3Time = Number.isFinite(idealStepTimes.idealStep3Time) ? idealStepTimes.idealStep3Time : null;

	const delayStep1 = subtractOrNull(userStep1Time, idealStep1Time);
	const delayStep2 = subtractOrNull(userStep2Time, idealStep2Time);
	const delayStep3 = subtractOrNull(userStep3Time, idealStep3Time);

	const firstFrameTs = trimmedFrameHistory.length ? Number(trimmedFrameHistory[0]?.timestamp) : null;
	const lastFrameTs = trimmedFrameHistory.length ? Number(trimmedFrameHistory[trimmedFrameHistory.length - 1]?.timestamp) : null;
	const frameSpanSeconds = Number.isFinite(lastFrameTs) && Number.isFinite(timingReferenceStartMs)
		? Math.max(0, (lastFrameTs - timingReferenceStartMs) / 1000)
		: null;

	const totalSessionDuration = Number.isFinite(frameSpanSeconds)
		? frameSpanSeconds
		: Math.max(0, (Number(sessionDurationMs) || 0) / 1000);

	return {
		sessionStartReferenceTimestampMs: timingReferenceStartMs,
		firstFrameTimestampMs: firstFrameTs,
		userStep1Time,
		userStep2Time,
		userStep3Time,
		idealStep1Time,
		idealStep2Time,
		idealStep3Time,
		delayStep1,
		delayStep2,
		delayStep3,
		totalSessionDuration,
	};
}

/**
 * CORRECTED ANGLE ERROR CLASSIFICATION
 * Thresholds: < 10° = Correct, 10-25° = Moderate, > 25° = Incorrect
 */
function classifyAngleError(error) {
	if (!Number.isFinite(error)) {
		return 'Unknown';
	}
	if (error < 10) {
		return 'Correct';
	}
	if (error <= 25) {
		return 'Moderate';
	}
	return 'Incorrect';
}

/**
 * CORRECTED STEP CLASSIFICATION BY AVERAGE ANGLE ERROR
 * Thresholds: < 10° = Correct, 10-25° = Moderate, > 25° = Incorrect
 */
function classifyStepByAverageError(averageError) {
	if (!Number.isFinite(averageError)) {
		return 'Unknown';
	}
	if (averageError < 10) {
		return 'Correct';
	}
	if (averageError <= 25) {
		return 'Moderate';
	}
	return 'Incorrect';
}

/**
 * ANGLE ERROR COMPUTATION WITH > 180° HANDLING
 * angleError = abs(userAngle - idealAngle)
 * if angleError > 180: angleError = 360 - angleError
 */
function computeAngleErrorDegrees(userAngle, idealAngle) {
	const user = Number(userAngle);
	const ideal = Number(idealAngle);

	if (!Number.isFinite(user) || !Number.isFinite(ideal)) {
		return NaN;
	}

	let error = Math.abs(user - ideal);
	if (error > 180) {
		error = 360 - error;
	}
	return error;
}

function buildStepAngleFeedback({ stepKey, averageError, performance, correctCount, moderateCount, incorrectCount, dominantJointError }) {
	if (!Number.isFinite(averageError)) {
		return `${stepKey}: No angle data captured for analysis.`;
	}

	const base = `${stepKey}: ${performance} form with average joint error ${averageError.toFixed(2)}°`;
	const distribution = `(${correctCount} correct, ${moderateCount} moderate, ${incorrectCount} incorrect joints)`;
	if (!dominantJointError) {
		return `${base} ${distribution}.`;
	}

	const dominantError = Number(dominantJointError.angleError);
	const dominantErrorText = Number.isFinite(dominantError) ? dominantError.toFixed(2) : 'N/A';
	return `${base} ${distribution}. Focus most on joint ${dominantJointError.jointIndex + 1} (${dominantErrorText}° error).`;
}

function buildAngleAnalysis(significantFrames, idealPoseReference) {
	const steps = ['step1', 'step2', 'step3'];
	const stepAnalysis = {};

	console.log('=== ANGLE ANALYSIS (SIGNIFICANT FRAMES ONLY) ===');
	console.log('JOINT ANGLE ORDER:', JOINT_ANGLE_ORDER);

	for (const stepKey of steps) {
		const userAngles = toDegreesMaybeNormalized(significantFrames?.[stepKey]?.angles);
		const idealAngles = Array.isArray(idealPoseReference?.[stepKey]?.idealAngles)
			? toDegreesMaybeNormalized(idealPoseReference[stepKey].idealAngles)
			: [];

		console.log(`\n${stepKey.toUpperCase()} Analysis:`);
		console.log(`  User Angles:   ${userAngles.map((a) => Number.isFinite(a) ? a.toFixed(1) : 'NaN').join(', ')}`);
		console.log(`  Ideal Angles:  ${idealAngles.map((a) => Number.isFinite(a) ? a.toFixed(1) : 'NaN').join(', ')}`);

		const jointCount = Math.min(userAngles.length, idealAngles.length);
		const jointAnalysis = [];
		const angleErrors = [];

		for (let i = 0; i < jointCount; i += 1) {
			const userAngle = Number(userAngles[i]);
			const idealAngle = Number(idealAngles[i]);
			const angleError = computeAngleErrorDegrees(userAngle, idealAngle);
			
			if (Number.isFinite(angleError)) {
				angleErrors.push(angleError);
			}

			jointAnalysis.push({
				jointIndex: i,
				jointName: JOINT_ANGLE_ORDER[i] || `joint${i}`,
				userAngle,
				idealAngle,
				angleError,
				classification: classifyAngleError(angleError),
			});
		}

		console.log(`  Angle Errors:  ${angleErrors.map((e) => e.toFixed(1)).join(', ')}°`);

		const averageError = angleErrors.length
			? angleErrors.reduce((sum, value) => sum + value, 0) / angleErrors.length
			: null;
		console.log(`  Average Error: ${Number.isFinite(averageError) ? averageError.toFixed(2) : 'N/A'}°`);

		const correctCount = jointAnalysis.filter((joint) => joint.classification === 'Correct').length;
		const moderateCount = jointAnalysis.filter((joint) => joint.classification === 'Moderate').length;
		const incorrectCount = jointAnalysis.filter((joint) => joint.classification === 'Incorrect').length;
		console.log(`  Classification: ${correctCount} Correct, ${moderateCount} Moderate, ${incorrectCount} Incorrect`);
		const dominantJointError = jointAnalysis
			.filter((joint) => Number.isFinite(joint.angleError))
			.reduce((worst, current) => {
				if (!worst) {
					return current;
				}
				return current.angleError > worst.angleError ? current : worst;
			}, null);

		const performance = classifyStepByAverageError(averageError);
		console.log(`  Step Result: ${performance}`);

		const feedback = buildStepAngleFeedback({
			stepKey,
			averageError,
			performance,
			correctCount,
			moderateCount,
			incorrectCount,
			dominantJointError,
		});

		stepAnalysis[stepKey] = {
			jointAnalysis,
			angleOrder: JOINT_ANGLE_ORDER,
			averageError,
			performance,
			feedback,
			jointSummary: {
				correct: correctCount,
				moderate: moderateCount,
				incorrect: incorrectCount,
			},
		};
	}

	const stepAverageErrors = steps
		.map((stepKey) => stepAnalysis[stepKey]?.averageError)
		.filter((value) => Number.isFinite(value));

	const overallAverageError = stepAverageErrors.length
		? stepAverageErrors.reduce((sum, value) => sum + value, 0) / stepAverageErrors.length
		: null;

	console.log(`\nOVERALL AVERAGE ERROR: ${Number.isFinite(overallAverageError) ? overallAverageError.toFixed(2) : 'N/A'}°`);
	console.log('=== END ANGLE ANALYSIS ===');

	return {
		steps: stepAnalysis,
		overallAverageError,
		overallPerformance: classifyStepByAverageError(overallAverageError),
	};
}

function clampScore(value) {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(100, value));
}

function calculateStepAccuracyScore(stepFrames) {
	if (!Array.isArray(stepFrames) || !stepFrames.length) {
		return 0;
	}

	const total = stepFrames.length;
	const correct = stepFrames.filter((frame) => frame?.label === 'correct').length;
	const moderate = stepFrames.filter((frame) => frame?.label === 'moderate').length;
	const incorrect = stepFrames.filter((frame) => frame?.label === 'incorrect').length;

	const normalized = (correct * 1 + moderate * 0.6 + incorrect * 0.2) / total;
	return clampScore(normalized * 100);
}

function calculateAngleAccuracyScore(stepAngleInfo) {
	const averageError = Number(stepAngleInfo?.averageError);
	if (!Number.isFinite(averageError)) {
		return 0;
	}

	// 0 degree error -> 100 score, 30+ degree error -> 0 score.
	return clampScore((1 - Math.min(averageError, 30) / 30) * 100);
}

function calculateTimingScoreForStep(delaySeconds) {
	const delay = Number(delaySeconds);
	if (!Number.isFinite(delay)) {
		return null;
	}

	const absDelay = Math.abs(delay);
	// 0s delay -> 100 score, 10s or more -> 0 score.
	return clampScore((1 - Math.min(absDelay, 10) / 10) * 100);
}

function calculateStabilityScore(stepFrames) {
	if (!Array.isArray(stepFrames) || !stepFrames.length) {
		return null;
	}

	const movements = stepFrames
		.map((frame) => Number(frame?.movement))
		.filter((value) => Number.isFinite(value));

	if (!movements.length) {
		return null;
	}

	const averageMovement = movements.reduce((sum, value) => sum + value, 0) / movements.length;
	// 0 movement -> 100 score, 0.12+ movement -> 0 score.
	return clampScore((1 - Math.min(averageMovement, 0.12) / 0.12) * 100);
}

function computeNormalizedWeightedScore(parts) {
	const validParts = parts.filter((part) => Number.isFinite(part?.score) && Number.isFinite(part?.weight) && part.weight > 0);
	if (!validParts.length) {
		return 0;
	}

	const weightedTotal = validParts.reduce((sum, part) => sum + (part.score * part.weight), 0);
	const weightTotal = validParts.reduce((sum, part) => sum + part.weight, 0);
	if (!Number.isFinite(weightTotal) || weightTotal <= 0) {
		return 0;
	}

	return clampScore(weightedTotal / weightTotal);
}

function buildSessionScores({ trimmedFrameHistory, angleAnalysis, timingAnalysis }) {
	const stepKeys = ['step1', 'step2', 'step3'];
	const perStep = {};
	if (!Array.isArray(trimmedFrameHistory) || trimmedFrameHistory.length === 0) {
		return {
			step1Score: 0,
			step2Score: 0,
			step3Score: 0,
			overallScore: 0,
			weights: {
				stepAccuracy: 0.4,
				angleAccuracy: 0.3,
				timing: 0.2,
				stability: 0.1,
			},
			perStep: {
				step1: { stepAccuracyScore: 0, angleAccuracyScore: null, timingScore: null, stabilityScore: null, weightedScore: 0 },
				step2: { stepAccuracyScore: 0, angleAccuracyScore: null, timingScore: null, stabilityScore: null, weightedScore: 0 },
				step3: { stepAccuracyScore: 0, angleAccuracyScore: null, timingScore: null, stabilityScore: null, weightedScore: 0 },
			},
		};
	}

	for (const stepKey of stepKeys) {
		const stepFrames = trimmedFrameHistory.filter((frame) => frame?.step === stepKey);
		const fallbackFrames = stepFrames.length ? stepFrames : trimmedFrameHistory;
		const stepAccuracyScore = calculateStepAccuracyScore(fallbackFrames);
		const hasAngleData = Number.isFinite(Number(angleAnalysis?.steps?.[stepKey]?.averageError));
		const angleAccuracyScore = hasAngleData ? calculateAngleAccuracyScore(angleAnalysis?.steps?.[stepKey]) : null;
		const timingDelay = stepKey === 'step1'
			? timingAnalysis?.delayStep1
			: stepKey === 'step2'
				? timingAnalysis?.delayStep2
				: timingAnalysis?.delayStep3;
		const timingScore = calculateTimingScoreForStep(timingDelay);
		const stabilityScore = calculateStabilityScore(fallbackFrames);
		const weightedStepScore = computeNormalizedWeightedScore([
			{ score: stepAccuracyScore, weight: 0.4 },
			{ score: angleAccuracyScore, weight: 0.3 },
			{ score: timingScore, weight: 0.2 },
			{ score: stabilityScore, weight: 0.1 },
		]);

		perStep[stepKey] = {
			stepAccuracyScore,
			angleAccuracyScore,
			timingScore,
			stabilityScore,
			weightedScore: weightedStepScore,
		};
	}

	const overallScore = clampScore(
		(stepKeys.reduce((sum, stepKey) => sum + Number(perStep[stepKey]?.weightedScore || 0), 0)) / stepKeys.length
	);

	return {
		step1Score: perStep.step1?.weightedScore || 0,
		step2Score: perStep.step2?.weightedScore || 0,
		step3Score: perStep.step3?.weightedScore || 0,
		overallScore,
		weights: {
			stepAccuracy: 0.4,
			angleAccuracy: 0.3,
			timing: 0.2,
			stability: 0.1,
		},
		perStep,
	};
}

const JOINT_NAMES = [
	'left_elbow',
	'right_elbow',
	'left_shoulder',
	'right_shoulder',
	'left_hip',
	'right_hip',
	'left_knee',
	'right_knee',
];

const JOINT_CORRECTION_TIPS = {
	left_elbow: 'Keep left arm long and avoid bending the elbow during side stretch.',
	right_elbow: 'Keep right arm long and avoid bending the elbow during side stretch.',
	left_shoulder: 'Lift left shoulder line upward and keep chest open.',
	right_shoulder: 'Lift right shoulder line upward and keep chest open.',
	left_hip: 'Stabilize left hip and avoid collapsing at the waist.',
	right_hip: 'Stabilize right hip and avoid collapsing at the waist.',
	left_knee: 'Keep left knee straight but not locked and ground the foot firmly.',
	right_knee: 'Keep right knee straight but not locked and ground the foot firmly.',
};

function getJointName(index) {
	return JOINT_NAMES[index] || `joint_${index + 1}`;
}

function getJointColor(classification) {
	if (classification === 'Correct') {
		return 'green';
	}
	if (classification === 'Moderate') {
		return 'yellow';
	}
	if (classification === 'Incorrect') {
		return 'red';
	}
	return 'gray';
}

function classifyTimingResult(delaySeconds) {
	const delay = Number(delaySeconds);
	if (!Number.isFinite(delay)) {
		return 'Unknown';
	}
	if (Math.abs(delay) <= 1) {
		return 'On Time';
	}
	return delay > 1 ? 'Delayed' : 'Faster than ideal';
}

function buildStepMistakesAndSuggestions(stepJointAnalysis) {
	const problematic = (Array.isArray(stepJointAnalysis) ? stepJointAnalysis : [])
		.filter((joint) => joint?.classification === 'Incorrect' || joint?.classification === 'Moderate')
		.sort((a, b) => (Number(b?.angleError) || 0) - (Number(a?.angleError) || 0));

	const topProblems = problematic.slice(0, 3);
	const mainMistakes = topProblems.map((joint) => {
		const jointName = getJointName(joint.jointIndex);
		const error = Number(joint.angleError);
		const errorText = Number.isFinite(error) ? `${error.toFixed(2)}°` : 'N/A';
		return `${jointName} (${errorText}, ${joint.classification})`;
	});

	const seenTips = new Set();
	const correctionSuggestions = [];
	for (const joint of topProblems) {
		const jointName = getJointName(joint.jointIndex);
		const suggestion = JOINT_CORRECTION_TIPS[jointName] || `Improve alignment around ${jointName}.`;
		if (!seenTips.has(suggestion)) {
			seenTips.add(suggestion);
			correctionSuggestions.push(suggestion);
		}
	}

	if (!mainMistakes.length) {
		mainMistakes.push('No major joint mistakes detected.');
	}
	if (!correctionSuggestions.length) {
		correctionSuggestions.push('Maintain your current alignment and hold each step steadily for longer.');
	}

	return { mainMistakes, correctionSuggestions };
}

function toFixedOrNull(value, digits = 2) {
	const num = Number(value);
	return Number.isFinite(num) ? Number(num.toFixed(digits)) : null;
}

const SKELETON_EDGES = [
	[5, 6],
	[5, 7],
	[7, 9],
	[6, 8],
	[8, 10],
	[5, 11],
	[6, 12],
	[11, 12],
	[11, 13],
	[13, 15],
	[12, 14],
	[14, 16],
];

function getPointFromKeypointFeatures(keypointFeatures, index) {
	if (!Array.isArray(keypointFeatures) || keypointFeatures.length < ((index * 2) + 2)) {
		return null;
	}

	const x = Number(keypointFeatures[index * 2]);
	const y = Number(keypointFeatures[(index * 2) + 1]);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}

	return { x, y };
}

function midpointPoint(a, b) {
	if (!a || !b) {
		return null;
	}
	return {
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
	};
}

function buildAngleJointColorMap(stepAngleAnalysis) {
	const map = {};
	const joints = Array.isArray(stepAngleAnalysis?.jointAnalysis) ? stepAngleAnalysis.jointAnalysis : [];
	for (const joint of joints) {
		if (!Number.isInteger(joint?.jointIndex)) {
			continue;
		}
		map[joint.jointIndex] = getJointColor(joint.classification);
	}
	return map;
}

function drawSkeletonImageForStep({ stepKey, significantFrame, stepAngleAnalysis }) {
	const keypointFeatures = significantFrame?.keypoints;
	if (!Array.isArray(keypointFeatures) || keypointFeatures.length < 34) {
		return null;
	}

	const canvas = document.createElement('canvas');
	canvas.width = 720;
	canvas.height = 720;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return null;
	}

	const pointByIndex = {};
	for (let i = 0; i < 17; i += 1) {
		pointByIndex[i] = getPointFromKeypointFeatures(keypointFeatures, i);
	}

	ctx.fillStyle = '#0a0a0a';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.strokeStyle = '#8c8c8c';
	ctx.lineWidth = 4;
	for (const [fromIdx, toIdx] of SKELETON_EDGES) {
		const from = pointByIndex[fromIdx];
		const to = pointByIndex[toIdx];
		if (!from || !to) {
			continue;
		}

		ctx.beginPath();
		ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
		ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
		ctx.stroke();
	}

	for (let i = 0; i < 17; i += 1) {
		const point = pointByIndex[i];
		if (!point) {
			continue;
		}

		ctx.beginPath();
		ctx.arc(point.x * canvas.width, point.y * canvas.height, 5, 0, Math.PI * 2);
		ctx.fillStyle = '#d9d9d9';
		ctx.fill();
	}

	const colorMap = buildAngleJointColorMap(stepAngleAnalysis);
	const highlightedPoints = [
		{ jointIndex: 0, point: pointByIndex[7] },
		{ jointIndex: 1, point: pointByIndex[8] },
		{ jointIndex: 2, point: pointByIndex[5] },
		{ jointIndex: 3, point: pointByIndex[6] },
		{ jointIndex: 4, point: pointByIndex[13] },
		{ jointIndex: 5, point: pointByIndex[14] },
		{ jointIndex: 6, point: midpointPoint(pointByIndex[11], pointByIndex[12]) },
		{ jointIndex: 7, point: midpointPoint(pointByIndex[5], pointByIndex[6]) },
	];

	for (const item of highlightedPoints) {
		if (!item.point) {
			continue;
		}

		ctx.beginPath();
		ctx.arc(item.point.x * canvas.width, item.point.y * canvas.height, 10, 0, Math.PI * 2);
		ctx.fillStyle = colorMap[item.jointIndex] || 'gray';
		ctx.fill();
	}

	ctx.fillStyle = '#ffffff';
	ctx.font = '22px sans-serif';
	ctx.fillText(`${stepKey.toUpperCase()} Skeleton`, 24, 36);
	ctx.font = '16px sans-serif';
	ctx.fillText('Green=Correct | Yellow=Moderate | Red=Incorrect', 24, 62);

	const fileName = `${stepKey}_skeleton.png`;
	return {
		step: stepKey,
		fileName,
		mimeType: 'image/png',
		dataUrl: canvas.toDataURL('image/png'),
	};
}

function generateSkeletonImages(significantFrames, angleAnalysis) {
	const steps = ['step1', 'step2', 'step3'];
	const images = {};

	for (const stepKey of steps) {
		images[stepKey] = drawSkeletonImageForStep({
			stepKey,
			significantFrame: significantFrames?.[stepKey],
			stepAngleAnalysis: angleAnalysis?.steps?.[stepKey],
		});
	}

	return images;
}

function stripSkeletonImageData(finalReport) {
	if (!finalReport) {
		return null;
	}

	const clone = structuredClone(finalReport);
	for (const stepKey of ['step1', 'step2', 'step3']) {
		const image = clone?.skeletonImages?.[stepKey];
		if (image?.dataUrl) {
			delete image.dataUrl;
		}
	}
	return clone;
}

function buildFinalSessionReport({
	asanaName,
	sessionDuration,
	sessionDurationMs,
	totalCapturedFrames,
	totalFrames,
	skippedFrameCount,
	timingAnalysis,
	angleAnalysis,
	sessionScores,
	skeletonImages,
	improvements,
	sessionDate,
}) {
	const steps = ['step1', 'step2', 'step3'];

	const stepWiseAnalysis = {};
	const skeletonVisualization = {};
	for (const stepKey of steps) {
		const stepAngle = angleAnalysis?.steps?.[stepKey] || {};
		const stepTimingDelay = stepKey === 'step1'
			? timingAnalysis?.delayStep1
			: stepKey === 'step2'
				? timingAnalysis?.delayStep2
				: timingAnalysis?.delayStep3;
		const timingResult = classifyTimingResult(stepTimingDelay);
		const { mainMistakes, correctionSuggestions } = buildStepMistakesAndSuggestions(stepAngle.jointAnalysis || []);

		stepWiseAnalysis[stepKey] = {
			timingResult: {
				status: timingResult,
				delaySeconds: toFixedOrNull(stepTimingDelay),
			},
			angleAccuracy: {
				averageAngleError: toFixedOrNull(stepAngle.averageError),
				performance: stepAngle.performance || 'Unknown',
				score: toFixedOrNull(sessionScores?.perStep?.[stepKey]?.angleAccuracyScore),
			},
			mainMistakes,
			correctionSuggestions,
		};

		skeletonVisualization[stepKey] = (stepAngle.jointAnalysis || []).map((joint) => ({
			jointIndex: joint.jointIndex,
			jointName: getJointName(joint.jointIndex),
			classification: joint.classification,
			color: getJointColor(joint.classification),
			angleError: toFixedOrNull(joint.angleError),
		}));
	}

	const stepResults = steps.map((stepKey) => ({
		step: stepKey,
		result: angleAnalysis?.steps?.[stepKey]?.performance || 'Unknown',
		score: toFixedOrNull(sessionScores?.[`${stepKey}Score`]),
	}));

	const angleScore = toFixedOrNull(
		((Number(sessionScores?.perStep?.step1?.angleAccuracyScore) || 0) +
			(Number(sessionScores?.perStep?.step2?.angleAccuracyScore) || 0) +
			(Number(sessionScores?.perStep?.step3?.angleAccuracyScore) || 0)) / 3
	);
	const timingScore = toFixedOrNull(
		((Number(sessionScores?.perStep?.step1?.timingScore) || 0) +
			(Number(sessionScores?.perStep?.step2?.timingScore) || 0) +
			(Number(sessionScores?.perStep?.step3?.timingScore) || 0)) / 3
	);
	const stabilityScore = toFixedOrNull(
		((Number(sessionScores?.perStep?.step1?.stabilityScore) || 0) +
			(Number(sessionScores?.perStep?.step2?.stabilityScore) || 0) +
			(Number(sessionScores?.perStep?.step3?.stabilityScore) || 0)) / 3
	);

	return {
		reportHeader: {
			poseName: asanaName,
			sessionDate,
			sessionDuration,
			overallScore: toFixedOrNull(sessionScores?.overallScore),
		},
		sessionSummary: {
			totalFrames: totalCapturedFrames,
			framesUsed: totalFrames,
			framesDropped: skippedFrameCount,
			stepResults,
		},
		stepWiseAnalysis,
		timingAnalysis: {
			idealTimes: {
				step1: toFixedOrNull(timingAnalysis?.idealStep1Time),
				step2: toFixedOrNull(timingAnalysis?.idealStep2Time),
				step3: toFixedOrNull(timingAnalysis?.idealStep3Time),
			},
			userTimes: {
				step1: toFixedOrNull(timingAnalysis?.userStep1Time),
				step2: toFixedOrNull(timingAnalysis?.userStep2Time),
				step3: toFixedOrNull(timingAnalysis?.userStep3Time),
			},
			delays: {
				step1: toFixedOrNull(timingAnalysis?.delayStep1),
				step2: toFixedOrNull(timingAnalysis?.delayStep2),
				step3: toFixedOrNull(timingAnalysis?.delayStep3),
			},
			totalSessionDuration: toFixedOrNull(timingAnalysis?.totalSessionDuration),
			sessionDurationMs,
		},
		angleAnalysis: {
			jointErrorsPerStep: {
				step1: skeletonVisualization.step1,
				step2: skeletonVisualization.step2,
				step3: skeletonVisualization.step3,
			},
			averageAngleError: {
				step1: toFixedOrNull(angleAnalysis?.steps?.step1?.averageError),
				step2: toFixedOrNull(angleAnalysis?.steps?.step2?.averageError),
				step3: toFixedOrNull(angleAnalysis?.steps?.step3?.averageError),
				overall: toFixedOrNull(angleAnalysis?.overallAverageError),
			},
		},
		skeletonVisualization,
		skeletonImages,
		overallScore: {
			stepScores: {
				step1: toFixedOrNull(sessionScores?.step1Score),
				step2: toFixedOrNull(sessionScores?.step2Score),
				step3: toFixedOrNull(sessionScores?.step3Score),
			},
			angleScore,
			timingScore,
			stabilityScore,
			finalScore: toFixedOrNull(sessionScores?.overallScore),
		},
		recommendations: Array.isArray(improvements) && improvements.length
			? improvements
			: ['Keep full body visible and maintain steady breathing during all steps.'],
	};
}

function formatFinalReportText(finalReport) {
	if (!finalReport) {
		return 'Final report not available.';
	}

	const header = finalReport.reportHeader || {};
	const summary = finalReport.sessionSummary || {};
	const steps = ['step1', 'step2', 'step3'];
	const lines = [];

	lines.push('YOGMITRA FINAL SESSION REPORT');
	lines.push('');
	lines.push('1. Report Header');
	lines.push(`- Pose Name: ${header.poseName || 'N/A'}`);
	lines.push(`- Session Date: ${header.sessionDate || 'N/A'}`);
	lines.push(`- Session Duration: ${header.sessionDuration || 'N/A'}`);
	lines.push(`- Overall Score: ${header.overallScore ?? 'N/A'}`);
	lines.push('');
	lines.push('2. Session Summary');
	lines.push(`- Total Frames: ${summary.totalFrames ?? 'N/A'}`);
	lines.push(`- Frames Used: ${summary.framesUsed ?? 'N/A'}`);
	lines.push(`- Frames Dropped: ${summary.framesDropped ?? 'N/A'}`);
	lines.push('- Step Results:');
	for (const result of summary.stepResults || []) {
		lines.push(`  ${result.step}: ${result.result} (score: ${result.score ?? 'N/A'})`);
	}
	lines.push('');
	lines.push('3. Step-wise Analysis');
	for (const stepKey of steps) {
		const step = finalReport.stepWiseAnalysis?.[stepKey] || {};
		lines.push(`- ${stepKey}:`);
		lines.push(`  Timing Result: ${step.timingResult?.status || 'N/A'} (delay: ${step.timingResult?.delaySeconds ?? 'N/A'}s)`);
		lines.push(`  Angle Accuracy: ${step.angleAccuracy?.performance || 'N/A'} (avg error: ${step.angleAccuracy?.averageAngleError ?? 'N/A'}°, score: ${step.angleAccuracy?.score ?? 'N/A'})`);
		lines.push(`  Main Mistakes: ${(step.mainMistakes || []).join(' | ') || 'N/A'}`);
		lines.push(`  Correction Suggestions: ${(step.correctionSuggestions || []).join(' | ') || 'N/A'}`);
	}
	lines.push('');
	lines.push('4. Timing Analysis');
	lines.push(`- Ideal Times: step1=${finalReport.timingAnalysis?.idealTimes?.step1 ?? 'N/A'}s, step2=${finalReport.timingAnalysis?.idealTimes?.step2 ?? 'N/A'}s, step3=${finalReport.timingAnalysis?.idealTimes?.step3 ?? 'N/A'}s`);
	lines.push(`- User Times: step1=${finalReport.timingAnalysis?.userTimes?.step1 ?? 'N/A'}s, step2=${finalReport.timingAnalysis?.userTimes?.step2 ?? 'N/A'}s, step3=${finalReport.timingAnalysis?.userTimes?.step3 ?? 'N/A'}s`);
	lines.push(`- Delays: step1=${finalReport.timingAnalysis?.delays?.step1 ?? 'N/A'}s, step2=${finalReport.timingAnalysis?.delays?.step2 ?? 'N/A'}s, step3=${finalReport.timingAnalysis?.delays?.step3 ?? 'N/A'}s`);
	lines.push('');
	lines.push('5. Angle Analysis');
	for (const stepKey of steps) {
		const avg = finalReport.angleAnalysis?.averageAngleError?.[stepKey];
		const joints = finalReport.angleAnalysis?.jointErrorsPerStep?.[stepKey] || [];
		lines.push(`- ${stepKey} average angle error: ${avg ?? 'N/A'}°`);
		lines.push(`  Joint errors: ${joints.map((joint) => `${joint.jointName}:${joint.angleError ?? 'N/A'}°`).join(' | ') || 'N/A'}`);
	}
	lines.push(`- Overall average angle error: ${finalReport.angleAnalysis?.averageAngleError?.overall ?? 'N/A'}°`);
	lines.push('');
	lines.push('6. Skeleton Visualization');
	lines.push('- Joint color legend: green=Correct, yellow=Moderate, red=Incorrect');
	lines.push('- Generated image files:');
	for (const stepKey of steps) {
		const imageFile = finalReport.skeletonImages?.[stepKey]?.fileName || `${stepKey}_skeleton.png (not generated)`;
		lines.push(`  ${imageFile}`);
	}
	for (const stepKey of steps) {
		const joints = finalReport.skeletonVisualization?.[stepKey] || [];
		lines.push(`- ${stepKey}: ${joints.map((joint) => `${joint.jointName}:${joint.color}`).join(' | ') || 'N/A'}`);
	}
	lines.push('');
	lines.push('7. Overall Score');
	lines.push(`- Step Scores: step1=${finalReport.overallScore?.stepScores?.step1 ?? 'N/A'}, step2=${finalReport.overallScore?.stepScores?.step2 ?? 'N/A'}, step3=${finalReport.overallScore?.stepScores?.step3 ?? 'N/A'}`);
	lines.push(`- Angle Score: ${finalReport.overallScore?.angleScore ?? 'N/A'}`);
	lines.push(`- Timing Score: ${finalReport.overallScore?.timingScore ?? 'N/A'}`);
	lines.push(`- Stability Score: ${finalReport.overallScore?.stabilityScore ?? 'N/A'}`);
	lines.push(`- Final Score: ${finalReport.overallScore?.finalScore ?? 'N/A'}`);
	lines.push('');
	lines.push('8. Recommendations');
	for (const rec of finalReport.recommendations || []) {
		lines.push(`- ${rec}`);
	}

	return lines.join('\n');
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
	if (sessionActive) {
		return;
	}
	console.log('Session Started');

	setSessionControlState(true);
	renderStatus('Starting session and webcam...');
	try {
		await startRealtimePipeline();
		console.log('Pose Detection Started');
	} catch (error) {
		setSessionActive(false);
		setSessionControlState(false);
		renderStatus(`Could not start session: ${error.message}`);
		return;
	}

	setSessionActive(true);
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
	appState.sessionProcessedFrameCount = 0;
	appState.hasLoggedPoseDetected = false;

	setSessionControlState(true);
	renderSessionSummary(null);
	renderLiveCoachTip('Session started. Hold pose and follow live cues.');
	renderStatus('Session started. Webcam is live and predictions are being tracked.');
}

async function finalizeSessionAnalysis() {
	console.log('=== COMPREHENSIVE TEMPORAL ANALYSIS PIPELINE (ENHANCED) ===');
	console.log('Raw Session Frames:', appState.sessionPredictions.length);

	// ==============================================================
	// ENHANCED PIPELINE: All-in-one temporal analysis with consistency
	// ==============================================================
	
	// STAGE 1: Run enhanced temporal pipeline (activity detection + frame selection)
	const enhancedPipeline = runEnhancedTemporalPipeline(appState.sessionPredictions);
	console.log('Enhanced Pipeline Result:', {
		step1Selected: enhancedPipeline.frames?.step1 ? 'YES' : 'NO',
		step2Selected: enhancedPipeline.frames?.step2 ? 'YES' : 'NO',
		step3Selected: enhancedPipeline.frames?.step3 ? 'YES' : 'NO',
		step1Tier: enhancedPipeline.selection?.step1?.tier,
		step2Tier: enhancedPipeline.selection?.step2?.tier,
		step3Tier: enhancedPipeline.selection?.step3?.tier,
	});

	// STAGE 2: Extract major segments for scoring
	const majorSegments = enhancedPipeline.segments;
	console.log('Major Segments:', {
		step1Frames: majorSegments.step1?.length || 0,
		step2Frames: majorSegments.step2?.length || 0,
		step3Frames: majorSegments.step3?.length || 0,
	});

	// STAGE 3: Load reference data for angle comparison
	const idealPoseReference = await loadIdealPoseReference();

	// STAGE 4: Frame consistency - use SAME frames for all downstream analysis
	const selectedFrames = enhancedPipeline.frames;
	console.log('\nFrame Consistency Check:');
	console.log('  step1: ' + (selectedFrames.step1?.timestamp ? `timestamp=${selectedFrames.step1.timestamp}` : 'null'));
	console.log('  step2: ' + (selectedFrames.step2?.timestamp ? `timestamp=${selectedFrames.step2.timestamp}` : 'null'));
	console.log('  step3: ' + (selectedFrames.step3?.timestamp ? `timestamp=${selectedFrames.step3.timestamp}` : 'null'));

	// STAGE 5: Build angle analysis using SELECTED frames
	console.log('\nStage: Angle Analysis');
	const angleAnalysis = buildAngleAnalysis(selectedFrames, idealPoseReference);

	// STAGE 6: Build timing analysis using SELECTED FRAME TIMESTAMPS (not all frames)
	console.log('\nStage: Timing Analysis (from selected frame timestamps)');
	const durationMs = appState.sessionStartTime ? Date.now() - appState.sessionStartTime : 0;
	const timingAnalysis = buildTimingAnalysisFromSelectedFrames(selectedFrames, appState.sessionStartTime, idealPoseReference);
	console.log('Timing:', {
		step1FrameTime: timingAnalysis.userStep1Time?.toFixed(2),
		step2FrameTime: timingAnalysis.userStep2Time?.toFixed(2),
		step3FrameTime: timingAnalysis.userStep3Time?.toFixed(2),
	});

	// STAGE 7: Build session scores from MAJOR SEGMENTS
	console.log('\nStage: Session Scoring (from major step segments)');
	const sessionScores = buildSessionScoresFromMajorSegments({
		majorSegments,
		angleAnalysis,
		timingAnalysis,
	});

	// STAGE 8: Generate skeleton images from SELECTED FRAMES (guaranteed to use same frames)
	console.log('\nStage: Skeleton Generation');
	const skeletonImages = generateSkeletonImages(selectedFrames, angleAnalysis);

	// STAGE 9: Frame summary (using major segments for label distribution)
	const frameSummary = {
		correct: majorSegments.step1.filter(f => f?.label === 'correct').length +
		         majorSegments.step2.filter(f => f?.label === 'correct').length +
		         majorSegments.step3.filter(f => f?.label === 'correct').length,
		moderate: majorSegments.step1.filter(f => f?.label === 'moderate').length +
		          majorSegments.step2.filter(f => f?.label === 'moderate').length +
		          majorSegments.step3.filter(f => f?.label === 'moderate').length,
		incorrect: majorSegments.step1.filter(f => f?.label === 'incorrect').length +
		           majorSegments.step2.filter(f => f?.label === 'incorrect').length +
		           majorSegments.step3.filter(f => f?.label === 'incorrect').length,
	};

	// STAGE 10: Build improvements
	const improvements = buildSessionImprovements({
		totalFrames: enhancedPipeline.validSequenceFrameCount,
		correctFrameCount: frameSummary.correct,
		moderateFrameCount: frameSummary.moderate,
		incorrectFrameCount: frameSummary.incorrect,
		skippedFrameCount: appState.skippedFrameCount,
	});

	// STAGE 11: Build final report
	const sessionDate = new Date().toISOString();
	const totalCapturedFrames = appState.sessionPredictions.length + appState.skippedFrameCount;
	const finalReport = buildFinalSessionReport({
		asanaName: appState.asana,
		sessionDuration: formatDuration(durationMs),
		sessionDurationMs: durationMs,
		totalCapturedFrames,
		totalFrames: enhancedPipeline.validSequenceFrameCount,
		skippedFrameCount: appState.skippedFrameCount,
		timingAnalysis,
		angleAnalysis,
		sessionScores,
		skeletonImages,
		improvements,
		sessionDate,
	});

	// STAGE 12: Store results with full pipeline metadata
	console.log('\n=== STORING SESSION REPORT ===');
	appState.sessionReport = {
		asanaName: appState.asana,
		sessionDuration: formatDuration(durationMs),
		sessionDurationMs: durationMs,
		totalCapturedFrames,
		totalFrames: enhancedPipeline.validSequenceFrameCount,
		correctFrameCount: frameSummary.correct,
		moderateFrameCount: frameSummary.moderate,
		incorrectFrameCount: frameSummary.incorrect,
		skippedFrameCount: appState.skippedFrameCount,
		averageScore: sessionScores.overallScore,
		finalResult: sessionScores.overallScore >= 70 ? 'Correct' : sessionScores.overallScore >= 50 ? 'Moderate' : 'Incorrect',
		leniencyApplied: isSeniorLeniencyEnabled(appState.userProfile?.age),
		selectedFrames,         // Frames used for all analyses (angle, timing, skeleton)
		majorSegments,          // Frames used for scoring
		timingAnalysis,
		angleAnalysis,
		sessionScores,
		finalReport,
		improvements,
		pipelineMetadata: {
			activityWindow: enhancedPipeline.activityWindow,
			frameSelectionTiers: enhancedPipeline.selection,
			validSequenceFrameCount: enhancedPipeline.validSequenceFrameCount,
		},
	};

	console.log('=== ENHANCED ANALYSIS COMPLETE ===');
	return { 
		totalFrames: enhancedPipeline.validSequenceFrameCount, 
		averageScore: sessionScores.overallScore, 
		finalResult: appState.sessionReport.finalResult 
	};
}

async function endSession() {
	if (!sessionActive && !hasRecoverableSessionData()) {
		renderStatus('No active session. Click Start Session first.');
		return false;
	}
	if (!sessionActive && hasRecoverableSessionData()) {
		renderStatus('Session state recovered. Finalizing with captured data...');
	}
	try {
		console.log('Session Ending');
		setSessionActive(false);
		setSessionControlState(false);
		stopRealtimePipeline();
		console.log('Pose Detection Stopped');

		const { totalFrames, averageScore, finalResult } = await finalizeSessionAnalysis();

		renderSessionSummary(appState.sessionReport);
		renderLiveCoachTip('Session completed. Start a new session to get live coaching cues.');
		if (!totalFrames) {
			renderStatus('Session ended, but no analyzable pose frames were captured. Keep your full body in frame and try again.');
			return false;
		}

		persistSessionHistoryEntry(appState.sessionReport);
		openSessionFeedbackModal();

		const leniencyNote = appState.sessionReport.leniencyApplied ? ' (age-aware scoring applied)' : '';
		renderStatus(`Session ended. Final result: ${finalResult} (${averageScore.toFixed(2)}/100)${leniencyNote}.`);
		return true;
	} catch (error) {
		console.error('endSession failed:', error);
		renderStatus(`Could not finalize session: ${error.message}`);
		return false;
	}
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
	renderReport('No report generated yet.', null);
	latestReportText = '';
	setDownloadReportState(false);
}

function stopRealtimePipeline() {
	if (poseStream) {
		poseStream.stop();
		poseStream = null;
	}

	for (const videoEl of [rawVideoEl, markedVideoEl]) {
		const stream = videoEl?.srcObject;
		if (stream && typeof stream.getTracks === 'function') {
			for (const track of stream.getTracks()) {
				track.stop();
			}
		}
		if (videoEl) {
			videoEl.srcObject = null;
		}
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
	setSessionActive(false);
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

	showDashboardView();
	document.getElementById('dashboardView').classList.add('hidden');
	const livePracticeView = document.getElementById('livePracticeView');
	if (livePracticeView) {
		livePracticeView.classList.add('hidden');
	}
	const reportView = document.getElementById('reportView');
	if (reportView) {
		reportView.classList.add('hidden');
	}
	document.getElementById('profileModal').classList.add('hidden');
	document.getElementById('loginView').classList.remove('hidden');

	resetAnalysisUI();
	renderStatus('Logged out. Please sign in again.');
}

async function onPoseFrame({ pose, keypointFeatures }) {
	if (!sessionActive) {
		return;
	}

	if (busyPredicting || Date.now() - lastPredictionAt < 240 || !appState.userProfile) {
		return;
	}

	busyPredicting = true;
	lastPredictionAt = Date.now();

	try {
		// ============ FRAME PREPROCESSING PIPELINE ============

		// STEP 1: Validate frame visibility
		const visibility = getPoseVisibilityScore(pose);
		if (visibility < 0.5) {
			console.log('Frame Dropped: visibility too low');
			recordSkippedSessionFrame();
			if (appState.latestPrediction) {
				renderPrediction({
					label: appState.latestPrediction.label,
					confidence: appState.latestPrediction.confidence,
					score: appState.latestScore,
					feedback: ['Visibility too low. Keep your full body visible for analysis.'],
				});
			}
			return;
		}

		// STEP 1.5: Apply KEYPOINT SMOOTHING (EMA) to reduce noise
		const previousSmoothedKp = previousSmoothedKeypoints ? [...previousSmoothedKeypoints] : null;
		const smoothedKeypoints = smoothKeypointsWithEMA(keypointFeatures);

		// STEP 2: Extract keypoints and compute average keypoint confidence
		const keypointConfidence = getAverageKeypointConfidence(pose);
		console.log(`Frame visibility: ${(visibility * 100).toFixed(1)}%, Avg keypoint confidence: ${(keypointConfidence * 100).toFixed(1)}%`);

		// STEP 3: Validate pose readiness
		if (!isPoseReadyForClassification(pose)) {
			console.log('Frame Dropped - No movement or low confidence');
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
				inputVector: smoothedKeypoints,
			};
			appState.latestFeedback = ['Step back so your full body is visible for yoga analysis.'];
			appState.latestScore = 0;
			recordSkippedSessionFrame();
			appState.stability.label = null;
			appState.stability.streak = 0;
			if (sessionActive && Date.now() - appState.lastLiveCoachAt > 900) {
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

		// STEP 4: Compute joint angles and movement (done by predictor with smoothed keypoints)
		// STEP 5 & 6: Generate feature vector and run model prediction
		let prediction = await predictor.predict(smoothedKeypoints, appState.userProfile);
		if (!appState.hasLoggedPoseDetected) {
			console.log('Pose Detected - Recording Frames');
			appState.hasLoggedPoseDetected = true;
		}

		// STEP 7: Apply post-processing guards and validate confidence threshold
		prediction = applyKonasanaQualityGuards(pose, prediction);
		
		// Check if prediction confidence meets the lower threshold for far users
		const meetsConfidenceThreshold = prediction.confidence >= CLASSIFICATION_CONFIDENCE_THRESHOLD;
		const meetsKeypointThreshold = keypointConfidence >= KEYPOINT_CONFIDENCE_THRESHOLD;
		
		if (!meetsConfidenceThreshold || !meetsKeypointThreshold) {
			console.log(`Frame Dropped: confidence ${(prediction.confidence * 100).toFixed(1)}% (threshold: ${(CLASSIFICATION_CONFIDENCE_THRESHOLD * 100).toFixed(1)}%), keypoint ${(keypointConfidence * 100).toFixed(1)}% (threshold: ${(KEYPOINT_CONFIDENCE_THRESHOLD * 100).toFixed(1)}%)`);
			recordSkippedSessionFrame();
			return;
		}

		// STEP 2: Calculate actual MOVEMENT between frames (normalized Euclidean distance)
		let movement = 0;
		if (previousSmoothedKp && Array.isArray(smoothedKeypoints)) {
			movement = calculateFrameMovement(smoothedKeypoints, previousSmoothedKp);
		}

		appState.sessionProcessedFrameCount += 1;
		console.log(
			`[FRAME PREPROCESSING] Frame ${appState.sessionProcessedFrameCount} | Step: ${prediction.step} | Label: ${prediction.label} | Model Conf: ${(prediction.confidence * 100).toFixed(1)}% | Keypoint Conf: ${(keypointConfidence * 100).toFixed(1)}% | Movement: ${movement.toFixed(4)}`
		);

		appState.lastPoseReadyAt = Date.now();
		const feedback = generateFeedback({ pose, prediction });
		const liveScore = applyAgeLeniencyToLiveScore(feedback.score, appState.userProfile?.age);
		updateStability(prediction);

		appState.latestPrediction = prediction;
		appState.latestFeedback = feedback.messages;
		appState.latestScore = liveScore;

		// STEP 8 & 9: Compute stability score and store frame object with movement
		// Pass smoothed keypoints and previous keypoints for movement calculation
		recordSessionFrame(prediction, smoothedKeypoints, keypointConfidence, previousSmoothedKp);

		const now = Date.now();
		if (sessionActive && now - appState.lastMonitorTipAt > 2600) {
			const monitorTip = getSessionMonitorTip();
			if (monitorTip) {
				renderLiveCoachTip(monitorTip);
				appState.lastMonitorTipAt = now;
				appState.lastLiveCoachAt = now;
			}
		}
		if (sessionActive && feedback.messages?.length && now - appState.lastLiveCoachAt > 900) {
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
		renderStatus(`Live analysis running. Detected ${prediction.step} -> ${prediction.label.toUpperCase()} (${(prediction.confidence * 100).toFixed(1)}%)`);
	} catch (error) {
		renderStatus(`Prediction error: ${error.message}`);
	} finally {
		busyPredicting = false;
	}
}

async function startRealtimePipeline() {
	stopRealtimePipeline();
	resetAnalysisUI();
	setSessionActive(false);
	resetSessionState();
	appState.lastValidSnapshot = null;
	appState.bestSnapshot = null;
	appState.recentSnapshots = [];
	appState.stability.label = null;
	appState.stability.streak = 0;
	appState.lastMonitorTipAt = 0;
	appState.lastPoseReadyAt = 0;
	predictor.previousKeypointFeatures = null;
	previousSmoothedKeypoints = null;  // Reset keypoint smoothing state

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
	setReportGenerationLoading(true, 'Generating your personalized report...');
	setReportAssistantAvailable(false);
	setChatbotInteractionEnabled(false);

	if (!appState.sessionReport) {
		if (hasRecoverableSessionData()) {
			renderStatus('No finalized session report found. Finalizing session automatically...');
			await endSession();
		}

		if (!appState.sessionReport) {
			renderReport('No session report available. Click Start Session, practice, then End Session before generating report.', null);
			latestReportText = '';
			setDownloadReportState(false);
			setReportGenerationLoading(false);
			setChatbotInteractionEnabled(true);
			return;
		}
	}

	const source = appState.sessionReport;
	const finalReportText = formatFinalReportText(source.finalReport || null);
	const finalReportForApi = stripSkeletonImageData(source.finalReport || null);
	const timing = source.timingAnalysis || {};
	const angleAnalysis = source.angleAnalysis || {};
	const stepAngleLines = ['step1', 'step2', 'step3'].map((stepKey) => {
		const stepInfo = angleAnalysis?.steps?.[stepKey];
		const avg = Number.isFinite(stepInfo?.averageError) ? `${stepInfo.averageError.toFixed(2)}°` : 'N/A';
		const perf = stepInfo?.performance || 'Unknown';
		return `${stepKey} angle performance: ${perf} (avg error: ${avg})`;
	});
	const consistency = source.totalFrames ? (source.correctFrameCount / source.totalFrames) * 100 : 0;
	const visibilityQuality = source.totalCapturedFrames
		? ((source.totalCapturedFrames - source.skippedFrameCount) / source.totalCapturedFrames) * 100
		: 0;
	const latestUserFeedback = source.userFeedback || null;
	const sessionFeedback = [
		`Session duration: ${source.sessionDuration}`,
		`Pose checks completed: ${source.totalFrames}`,
		`Step1 timing: ${Number.isFinite(timing.userStep1Time) ? `${timing.userStep1Time.toFixed(2)}s` : 'N/A'} (ideal: ${Number.isFinite(timing.idealStep1Time) ? `${timing.idealStep1Time.toFixed(2)}s` : 'N/A'})`,
		`Step2 timing: ${Number.isFinite(timing.userStep2Time) ? `${timing.userStep2Time.toFixed(2)}s` : 'N/A'} (ideal: ${Number.isFinite(timing.idealStep2Time) ? `${timing.idealStep2Time.toFixed(2)}s` : 'N/A'})`,
		`Step3 timing: ${Number.isFinite(timing.userStep3Time) ? `${timing.userStep3Time.toFixed(2)}s` : 'N/A'} (ideal: ${Number.isFinite(timing.idealStep3Time) ? `${timing.idealStep3Time.toFixed(2)}s` : 'N/A'})`,
		`Step delays: step1=${Number.isFinite(timing.delayStep1) ? `${timing.delayStep1.toFixed(2)}s` : 'N/A'}, step2=${Number.isFinite(timing.delayStep2) ? `${timing.delayStep2.toFixed(2)}s` : 'N/A'}, step3=${Number.isFinite(timing.delayStep3) ? `${timing.delayStep3.toFixed(2)}s` : 'N/A'}`,
		...stepAngleLines,
		`Overall angle performance: ${angleAnalysis?.overallPerformance || 'Unknown'} (avg error: ${Number.isFinite(angleAnalysis?.overallAverageError) ? `${angleAnalysis.overallAverageError.toFixed(2)}°` : 'N/A'})`,
		`Session weighted scores: step1=${Number(source.sessionScores?.step1Score || 0).toFixed(2)}, step2=${Number(source.sessionScores?.step2Score || 0).toFixed(2)}, step3=${Number(source.sessionScores?.step3Score || 0).toFixed(2)}, overall=${Number(source.sessionScores?.overallScore || 0).toFixed(2)}`,
		`Consistency score: ${consistency.toFixed(1)}%`,
		`Visibility quality: ${visibilityQuality.toFixed(1)}%`,
		`Stable posture moments: ${source.correctFrameCount}`,
		`Needs-adjustment moments: ${source.moderateFrameCount + source.incorrectFrameCount}`,
		`Session final result: ${source.finalResult}`,
		`Session average score: ${source.averageScore.toFixed(2)} / 100`,
		`Improvements needed: ${(source.improvements || []).join(' | ')}`,
		`User feedback overall rating: ${latestUserFeedback?.overallRating ?? 'N/A'} / 5`,
		`User feedback confidence: before=${latestUserFeedback?.confidenceBeforeSession ?? 'N/A'} / 5, after=${latestUserFeedback?.confidenceAfterSession ?? 'N/A'} / 5, delta=${Number.isFinite(Number(latestUserFeedback?.confidenceDelta)) ? Number(latestUserFeedback.confidenceDelta).toFixed(0) : 'N/A'}`,
		`User feedback discomfort: level=${latestUserFeedback?.discomfortLevel || 'none'}, area=${latestUserFeedback?.painArea || 'N/A'}, intensity=${latestUserFeedback?.painIntensity ?? 'N/A'} / 10`,
		`User feedback hardest step: ${latestUserFeedback?.hardestStep || 'N/A'}`,
		`User feedback correction focus: ${latestUserFeedback?.correctionFocus || 'N/A'}`,
		`User feedback main challenge: ${latestUserFeedback?.mainChallenge || 'N/A'}`,
		`User feedback next session goal: ${latestUserFeedback?.nextSessionGoal || 'N/A'}`,
		`User feedback coach helpfulness: ${latestUserFeedback?.coachHelpfulness ?? 'N/A'} / 5`,
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
			timingAnalysis: source.timingAnalysis || null,
			angleAnalysis: source.angleAnalysis || null,
			sessionScores: source.sessionScores || null,
			finalReport: finalReportForApi,
			improvements: source.improvements || [],
		},
		finalReport: finalReportForApi,
		feedback: sessionFeedback,
		formattedFinalReport: finalReportText,
	};

	renderReport('Generating report...', source.finalReport || null, null);
	latestReportText = '';
	setDownloadReportState(false);
	try {
		const reportResponse = await generateYogaReport({
			data: reportData,
		});
		renderReport(reportResponse.text, source.finalReport || null, {
			source: reportResponse.source,
			model: reportResponse.model,
			reason: reportResponse.reason,
		});
		latestReportText = reportResponse.text;
		setDownloadReportState(true);
		setReportAssistantAvailable(true);
		console.log('Report Generated');
	} catch (error) {
		const fallbackText = `${finalReportText}\n\nNote: Could not generate OpenRouter report: ${error.message}`;
		renderReport(fallbackText, source.finalReport || null, {
			source: 'fallback',
			reason: 'report_api_error',
			model: null,
		});
		latestReportText = fallbackText;
		setDownloadReportState(true);
		setReportAssistantAvailable(true);
	} finally {
		setReportGenerationLoading(false);
		setChatbotInteractionEnabled(true);
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

if (chatbotFormEl) {
	chatbotFormEl.addEventListener('submit', handleChatbotSubmit);
}

if (reportAssistantToggleBtnEl) {
	reportAssistantToggleBtnEl.addEventListener('click', () => {
		const isHidden = reportAssistantPanelEl?.classList.contains('hidden');
		setReportAssistantOpen(Boolean(isHidden));
	});
}

if (reportAssistantCloseBtnEl) {
	reportAssistantCloseBtnEl.addEventListener('click', () => {
		setReportAssistantOpen(false);
	});
}

if (feedbackDiscomfortEl) {
	feedbackDiscomfortEl.addEventListener('change', (event) => {
		setFeedbackPainAreaVisibility(String(event?.target?.value || 'none'));
	});
}

if (sessionFeedbackFormEl) {
	sessionFeedbackFormEl.addEventListener('submit', handleSessionFeedbackSubmit);
}

if (feedbackSkipBtnEl) {
	feedbackSkipBtnEl.addEventListener('click', handleSessionFeedbackSkip);
}

setDownloadReportState(false);
setReportAssistantAvailable(false);

window.addEventListener('beforeunload', () => {
	stopRealtimePipeline();
});

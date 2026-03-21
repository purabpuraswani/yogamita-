const ASANA_DATA = {
	Konasana: {
		description:
			'Konasana (angle pose) stretches the sides of the body, improves spinal flexibility, and helps with balance and breathing control. Keep both feet grounded and lengthen through the raised arm while bending sideways.',
		faqs: [
			'Q: Should my knees bend? A: Keep both knees straight but not locked.',
			'Q: How far should I bend? A: Bend until you feel a stretch without collapsing your chest.',
			'Q: Where should my gaze be? A: Look forward or slightly upward while keeping the neck relaxed.',
		],
		anatomicalFocus: {
			targetMuscles: 'Obliques, Core, Shoulders, Hamstrings & Inner Thighs',
			healthBenefits: 'Improves spinal flexibility, strengthens core, enhances digestion, and reduces back stiffness.',
			precautions: 'Avoid with lower back injury. Only bend sideways. Don\'t overstretch. Maintain steady breathing.',
		},
		tutorialSteps: [
			{
				title: 'Step 1',
				caption: 'Stand tall with feet apart and raise one arm straight overhead.',
				videoUrl: 'src/konasana video.mp4',
			},
			{
				title: 'Step 2',
				caption: 'Bend sideways from the waist while keeping chest open and legs straight.',
				videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
			},
			{
				title: 'Step 3',
				caption: 'Hold the posture with steady breathing, then return slowly to center.',
				videoUrl: 'https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-mp4-file.mp4',
			},
		],
	},
};

function getPredictionClass(label) {
	if (label === 'correct') return 'pred-correct';
	if (label === 'moderate') return 'pred-moderate';
	if (label === 'incorrect') return 'pred-incorrect';
	return '';
}

export function initDashboard({ onAsanaChanged, onGenerateReport, onLogout, onStartSession, onEndSession }) {
	const asanaSelect = document.getElementById('asanaSelect');
	const asanaDescription = document.getElementById('asanaDescription');
	const faqList = document.getElementById('faqList');
	const anatomicalFocusContainer = document.getElementById('anatomicalFocusContainer');
	const tutorialVideo = document.getElementById('tutorialVideo');
	const tutorialSteps = document.getElementById('tutorialSteps');
	const generateReportBtn = document.getElementById('generateReportBtn');
	const startSessionBtn = document.getElementById('startSessionBtn');
	const endSessionBtn = document.getElementById('endSessionBtn');
	const logoutBtn = document.getElementById('logoutBtn');
	const tutorialStaticSteps = document.getElementById('tutorialStaticSteps');

	tutorialVideo.addEventListener('pause', () => {
		tutorialStaticSteps.style.display = 'grid';
	});

	tutorialVideo.addEventListener('play', () => {
		tutorialStaticSteps.style.display = 'none';
	});

	function renderAsana(asanaName) {
		const config = ASANA_DATA[asanaName];
		asanaDescription.textContent = config.description;
		faqList.innerHTML = config.faqs.map((item) => {
			const splitIdx = item.indexOf(' A: ');
			const q = item.substring(0, splitIdx).replace('Q: ', '');
			const a = item.substring(splitIdx + 4);
			return `
				<div class="faq-item">
					<div class="faq-q">${q}</div>
					<div class="faq-a">${a}</div>
				</div>
			`;
		}).join('');

		if (config.anatomicalFocus) {
			anatomicalFocusContainer.innerHTML = `
				<div class="focus-row">
					<strong>Target Muscles:</strong> <span>${config.anatomicalFocus.targetMuscles}</span>
				</div>
				<div class="focus-row">
					<strong>Benefits:</strong> <span>${config.anatomicalFocus.healthBenefits}</span>
				</div>
				<div class="focus-row">
					<strong>Precautions:</strong> <span>${config.anatomicalFocus.precautions}</span>
				</div>
			`;
			anatomicalFocusContainer.parentElement.style.display = 'block';
		} else {
			anatomicalFocusContainer.parentElement.style.display = 'none';
		}

		// tutorialSteps.innerHTML = '';
		// config.tutorialSteps.forEach((step, index) => {
		// 	const button = document.createElement('button');
		// 	button.type = 'button';
		// 	button.className = `step-btn ${index === 0 ? 'active' : ''}`;
		// 	button.textContent = step.title;
		// 	button.addEventListener('click', () => {
		// 		tutorialVideo.src = step.videoUrl;
		// 		tutorialCaption.textContent = step.caption;
		// 		for (const sibling of tutorialSteps.querySelectorAll('.step-btn')) {
		// 			sibling.classList.remove('active');
		// 		}
		// 		button.classList.add('active');
		// 		if (tutorialVideo.paused) {
		// 			tutorialStaticSteps.style.display = 'grid';
		// 		} else {
		// 			tutorialStaticSteps.style.display = 'none';
		// 		}
		// 	});
		// 	tutorialSteps.appendChild(button);
		// });

		tutorialVideo.src = config.tutorialSteps[0].videoUrl;
		
		if (tutorialVideo.paused) {
			tutorialStaticSteps.style.display = 'grid';
		} else {
			tutorialStaticSteps.style.display = 'none';
		}
		onAsanaChanged(asanaName);
	}

	asanaSelect.addEventListener('change', () => renderAsana(asanaSelect.value));
	generateReportBtn.addEventListener('click', onGenerateReport);
	if (startSessionBtn && typeof onStartSession === 'function') {
		startSessionBtn.addEventListener('click', onStartSession);
	}
	if (endSessionBtn && typeof onEndSession === 'function') {
		endSessionBtn.addEventListener('click', onEndSession);
	}
	if (logoutBtn && typeof onLogout === 'function') {
		logoutBtn.addEventListener('click', onLogout);
	}

	renderAsana(asanaSelect.value);
}

export function renderPrediction({ label, confidence, score, feedback }) {
	const predictionEl = document.getElementById('predictionResult');
	const confidenceEl = document.getElementById('predictionConfidence');
	const scoreEl = document.getElementById('poseScore');
	const feedbackList = document.getElementById('feedbackList');

	predictionEl.textContent = label ? label.toUpperCase() : '-';
	predictionEl.className = getPredictionClass(label);
	confidenceEl.textContent = Number.isFinite(confidence) ? `${(confidence * 100).toFixed(1)}%` : '-';
	scoreEl.textContent = Number.isFinite(score) ? score.toFixed(1) : '-';

	feedbackList.innerHTML = '';
	const items = feedback?.length ? feedback : ['Waiting for stable pose...'];
	for (const message of items) {
		const li = document.createElement('li');
		li.textContent = message;
		feedbackList.appendChild(li);
	}
}

export function renderStatus(message) {
	document.getElementById('statusText').textContent = message;
}

export function renderReport(text) {
	document.getElementById('reportOutput').textContent = text;
}

export function renderLiveCoachTip(text) {
	const liveCoachEl = document.getElementById('liveCoachTip');
	if (!liveCoachEl) {
		return;
	}

	liveCoachEl.textContent = text || 'Start session to get real-time posture cues.';
}

export function setSessionControlState(sessionActive) {
	const startSessionBtn = document.getElementById('startSessionBtn');
	const endSessionBtn = document.getElementById('endSessionBtn');
	if (!startSessionBtn || !endSessionBtn) {
		return;
	}

	startSessionBtn.disabled = Boolean(sessionActive);
	endSessionBtn.disabled = !sessionActive;
}

export function renderSessionSummary(sessionReport) {
	const summaryEl = document.getElementById('sessionSummary');
	if (!summaryEl) {
		return;
	}

	if (!sessionReport) {
		summaryEl.textContent = 'No session completed yet.';
		return;
	}

	const consistency = sessionReport.totalFrames
		? (sessionReport.correctFrameCount / sessionReport.totalFrames) * 100
		: 0;
	const visibilityQuality = sessionReport.totalCapturedFrames
		? ((sessionReport.totalCapturedFrames - sessionReport.skippedFrameCount) / sessionReport.totalCapturedFrames) * 100
		: 0;
	summaryEl.textContent = `Result: ${sessionReport.finalResult} | Avg: ${sessionReport.averageScore.toFixed(2)}/10 | Consistency: ${consistency.toFixed(0)}% | Visibility: ${visibilityQuality.toFixed(0)}% | Duration: ${sessionReport.sessionDuration}`;
}

export function setWelcomeText(user) {
	const text = user?.fullName
		? `Welcome, ${user.fullName} (${user.email})`
		: `Welcome, ${user?.email || 'User'}`;
	document.getElementById('welcomeText').textContent = text;
}

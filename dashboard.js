const FALLBACK_ASANA_CATALOG = [
	{
		id: 'konasana',
		name: 'Konasana',
		description:
			'Konasana (angle pose) stretches the sides of the body, improves spinal flexibility, and helps with balance and breathing control. Keep both feet grounded and lengthen through the raised arm while bending sideways.',
		faqs: [
			'Q: Should my knees bend? A: Keep both knees straight but not locked.',
			'Q: How far should I bend? A: Bend until you feel a stretch without collapsing your chest.',
			'Q: Where should my gaze be? A: Look forward or slightly upward while keeping the neck relaxed.',
		],
		anatomicalFocus: {
			targetMuscles: '<ul><li><b>Obliques (side abdominal muscles)</b> – primary muscles engaged during the side bend</li><li><b>Core muscles</b> – stabilize the body and maintain balance</li><li><b>Shoulders & arms</b> – support the raised arm and help in stretching</li><li><b>Hamstrings & inner thighs</b> – lightly stretched due to wide stance</li></ul>',
			healthBenefits: '<ul><li>Improves flexibility of the spine, especially side bending</li><li>Strengthens the core and waist muscles</li><li>Enhances digestion by compressing and stretching abdominal organs</li><li>Improves posture and balance</li><li>Helps in reducing stiffness in the back and sides</li></ul>',
			precautions: '<ul><li>Avoid if you have lower back injury or severe spinal issues</li><li>Do not bend forward or backward — only sideways bending should be done</li><li>Avoid overstretching; go only as far as comfortable</li><li>Keep breathing normal and steady</li></ul>',
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
				videoUrl: 'src/konasana video.mp4',
			},
			{
				title: 'Step 3',
				caption: 'Hold the posture with steady breathing, then return slowly to center.',
				videoUrl: 'src/konasana video.mp4',
			},
		],
		photoLinks: [
			'src/konasana step 1.png',
			'src/konasana step 2.png',
			'src/konasana step 3.png',
		],
		videoLinks: ['src/konasana video.mp4'],
		tutorialCaption: 'Follow this guided Konasana demo video.',
	},
];

function getAsanaDataMap() {
	const catalog = Array.isArray(window.__yogmitraAsanas) && window.__yogmitraAsanas.length
		? window.__yogmitraAsanas
		: FALLBACK_ASANA_CATALOG;

	const map = {};
	for (const asana of catalog) {
		const asanaName = asana?.name || asana?.id || 'Unknown Asana';
		const photoLinks = Array.isArray(asana?.photoLinks) ? asana.photoLinks : [];
		const videoLinks = Array.isArray(asana?.videoLinks) ? asana.videoLinks : [];

		map[asanaName] = {
			description: asana?.description || 'Details not available.',
			faqs: Array.isArray(asana?.faqs) && asana.faqs.length ? asana.faqs : ['Details not available.'],
			tutorialVideo: {
				caption: asana?.tutorialCaption || 'Details not available.',
				videoUrl: videoLinks[0] || 'src/konasana video.mp4',
			},
			poseImages: photoLinks.map((src, index) => ({
				src,
				alt: `${asanaName} pose example ${index + 1}`,
			})),
			anatomicalFocus: asana?.anatomicalFocus || null,
			tutorialSteps: asana?.tutorialSteps || [],
		};
	}

	return map;
}

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
	const tutorialCaption = document.getElementById('tutorialCaption');
	const tutorialPoseGallery = document.getElementById('tutorialPoseGallery');
	const tutorialModeToggle = document.getElementById('tutorialModeToggle');
	const generateReportBtn = document.getElementById('generateReportBtn');
	const startSessionBtn = document.getElementById('startSessionBtn');
	const endSessionBtn = document.getElementById('endSessionBtn');
	const logoutBtn = document.getElementById('logoutBtn');

	let currentTutorialMode = 'pose';
	const ASANA_DATA = getAsanaDataMap();

	function setTutorialMode(mode) {
		currentTutorialMode = mode;
		const showPose = mode !== 'video';

		if (tutorialPoseGallery) tutorialPoseGallery.classList.toggle('hidden', !showPose);
		if (tutorialVideo) tutorialVideo.classList.toggle('hidden', showPose);
		if (tutorialModeToggle) tutorialModeToggle.textContent = showPose ? 'Show Video' : 'Show Pose';
	}

	function renderPoseGallery(images) {
		if (!tutorialPoseGallery) return;
		tutorialPoseGallery.innerHTML = '';
		if (!images.length) {
			const emptyItem = document.createElement('div');
			emptyItem.className = 'tutorial-pose-item tutorial-pose-item-empty';
			emptyItem.textContent = 'Pose images not available.';
			tutorialPoseGallery.appendChild(emptyItem);
			return;
		}

		images.forEach((image, index) => {
			const item = document.createElement('div');
			item.className = 'tutorial-pose-item';
			item.style.flexDirection = 'column';
			item.style.justifyContent = 'flex-start';
			item.style.padding = '8px';
			item.style.gap = '8px';

			const img = document.createElement('img');
			img.src = image.src;
			img.alt = image.alt;
			img.style.borderRadius = '8px';
			img.style.width = '100%';
			img.style.height = 'auto';
			img.style.flex = '1';
			img.style.objectFit = 'cover';

			const label = document.createElement('p');
			label.textContent = `Step ${index + 1}`;
			label.style.margin = '0';
			label.style.fontWeight = 'bold';
			label.style.color = 'white';
			label.style.textAlign = 'center';
			label.style.fontSize = '0.9rem';

			item.appendChild(img);
			item.appendChild(label);
			tutorialPoseGallery.appendChild(item);
		});
	}

	function renderAsana(asanaName) {
		const config = ASANA_DATA[asanaName] || ASANA_DATA.Konasana || Object.values(ASANA_DATA)[0];
		asanaDescription.textContent = config.description;
		if (faqList) {
			faqList.innerHTML = config.faqs.map((item) => {
				const splitIdx = item.indexOf(' A: ');
				if (splitIdx !== -1) {
					const q = item.substring(0, splitIdx).replace('Q: ', '');
					const a = item.substring(splitIdx + 4);
					return `
						<div class="faq-item">
							<div class="faq-q">${q}</div>
							<div class="faq-a">${a}</div>
						</div>
					`;
				}
				return `<div class="faq-item"><div class="faq-q">${item}</div></div>`;
			}).join('');
		}

		if (anatomicalFocusContainer) {
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
		}

		if (tutorialVideo) tutorialVideo.src = config.tutorialSteps && config.tutorialSteps.length ? config.tutorialSteps[0].videoUrl : (config.tutorialVideo ? config.tutorialVideo.videoUrl : '');
		if (tutorialCaption && config.tutorialVideo) tutorialCaption.textContent = config.tutorialVideo.caption;

		if (typeof renderPoseGallery === 'function') {
			renderPoseGallery(config.poseImages || []);
		}
		if (typeof setTutorialMode === 'function') {
			setTutorialMode('pose');
		}
		onAsanaChanged(asanaName);
	}

	tutorialModeToggle.addEventListener('click', () => {
		setTutorialMode(currentTutorialMode === 'pose' ? 'video' : 'pose');
	});

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

	if (predictionEl) {
		predictionEl.textContent = label ? label.toUpperCase() : '-';
		predictionEl.className = getPredictionClass(label);
	}
	if (confidenceEl) {
		confidenceEl.textContent = Number.isFinite(confidence) ? `${(confidence * 100).toFixed(1)}%` : '-';
	}
	if (scoreEl) {
		scoreEl.textContent = Number.isFinite(score) ? score.toFixed(1) : '-';
	}

	if (feedbackList) {
		feedbackList.innerHTML = '';
		const items = feedback?.length ? feedback : ['Waiting for stable pose...'];
		for (const message of items) {
			const li = document.createElement('li');
			li.textContent = message;
			feedbackList.appendChild(li);
		}
	}
}

export function renderStatus(message) {
	document.getElementById('statusText').textContent = message;
}

export function renderReport(text, finalReport = null) {
	const outputEl = document.getElementById('reportOutput');
	if (outputEl) {
		outputEl.textContent = text;
	}

	const visualsEl = document.getElementById('reportVisuals');
	if (!visualsEl) {
		return;
	}

	visualsEl.innerHTML = '';
	const images = finalReport?.skeletonImages || null;
	if (!images) {
		return;
	}

	for (const stepKey of ['step1', 'step2', 'step3']) {
		const imageInfo = images[stepKey];
		if (!imageInfo?.dataUrl) {
			continue;
		}

		const card = document.createElement('div');
		card.className = 'report-visual-card';

		const title = document.createElement('h4');
		title.textContent = `${stepKey.toUpperCase()} Skeleton`;

		const image = document.createElement('img');
		image.src = imageInfo.dataUrl;
		image.alt = imageInfo.fileName || `${stepKey} skeleton image`;

		card.appendChild(title);
		card.appendChild(image);
		visualsEl.appendChild(card);
	}
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

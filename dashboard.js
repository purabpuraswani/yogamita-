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
				videoUrl: 'src/Long Konasana video with music.mp4',
			},
			{
				title: 'Step 2',
				caption: 'Bend sideways from the waist while keeping chest open and legs straight.',
				videoUrl: 'src/Long Konasana video with music.mp4',
			},
			{
				title: 'Step 3',
				caption: 'Hold the posture with steady breathing, then return slowly to center.',
				videoUrl: 'src/Long Konasana video with music.mp4',
			},
		],
		photoLinks: [
			'src/konasana step 1.png',
			'src/konasana step 2.png',
			'src/konasana step 3.png',
		],
		videoLinks: ['src/Long Konasana video with music.mp4'],
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
				videoUrl: videoLinks[0] || 'src/Long Konasana video with music.mp4',
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
	const dashboardView = document.getElementById('dashboardView');
	const livePracticeView = document.getElementById('livePracticeView');
	const openLivePracticeBtn = document.getElementById('openLivePracticeBtn');
	const backToDashboardBtn = document.getElementById('backToDashboardBtn');
	const asanaSelect = document.getElementById('asanaSelect');
	const asanaDescription = document.getElementById('asanaDescription');
	const faqList = document.getElementById('faqList');
	const anatomicalFocusContainer = document.getElementById('anatomicalFocusContainer');
	const tutorialVideo = document.getElementById('tutorialVideo');
	const tutorialCaption = document.getElementById('tutorialCaption');
	const tutorialPoseGallery = document.getElementById('tutorialPoseGallery');
	const tutorialModeToggle = document.getElementById('tutorialModeToggle');
	const tutorialVideoDashboard = document.getElementById('tutorialVideoDashboard');
	const tutorialCaptionDashboard = document.getElementById('tutorialCaptionDashboard');
	const tutorialPoseGalleryDashboard = document.getElementById('tutorialPoseGalleryDashboard');
	const tutorialModeToggleDashboard = document.getElementById('tutorialModeToggleDashboard');
	const generateReportBtn = document.getElementById('generateReportBtn');
	const startSessionBtn = document.getElementById('startSessionBtn');
	const endSessionBtn = document.getElementById('endSessionBtn');
	const logoutBtn = document.getElementById('logoutBtn');
	const logoutBtnLive = document.getElementById('logoutBtnLive');

	const tutorialContexts = [
		{
			poseGallery: tutorialPoseGallery,
			video: tutorialVideo,
			caption: tutorialCaption,
			toggle: tutorialModeToggle,
			mode: 'pose',
		},
		{
			poseGallery: tutorialPoseGalleryDashboard,
			video: tutorialVideoDashboard,
			caption: tutorialCaptionDashboard,
			toggle: tutorialModeToggleDashboard,
			mode: 'pose',
		},
	].filter((ctx) => ctx.poseGallery || ctx.video || ctx.caption || ctx.toggle);

	const ASANA_DATA = getAsanaDataMap();

	function setTutorialModeForContext(context, mode) {
		if (!context) return;
		context.mode = mode;
		const showPose = mode !== 'video';

		if (context.poseGallery) context.poseGallery.classList.toggle('hidden', !showPose);
		if (context.video) context.video.classList.toggle('hidden', showPose);
		if (context.toggle) context.toggle.textContent = showPose ? 'Show Video' : 'Show Pose';
	}

	function renderPoseGallery(container, images) {
		if (!container) return;
		container.innerHTML = '';
		if (!images.length) {
			const emptyItem = document.createElement('div');
			emptyItem.className = 'tutorial-pose-item tutorial-pose-item-empty';
			emptyItem.textContent = 'Pose images not available.';
			container.appendChild(emptyItem);
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
			container.appendChild(item);
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

		for (const context of tutorialContexts) {
			if (context.video) {
				context.video.src = config.tutorialSteps && config.tutorialSteps.length
					? config.tutorialSteps[0].videoUrl
					: (config.tutorialVideo ? config.tutorialVideo.videoUrl : '');
			}
			if (context.caption && config.tutorialVideo) {
				context.caption.textContent = config.tutorialVideo.caption;
			}
			renderPoseGallery(context.poseGallery, config.poseImages || []);
			setTutorialModeForContext(context, 'pose');
		}
		onAsanaChanged(asanaName);
	}

	for (const context of tutorialContexts) {
		if (context.toggle) {
			context.toggle.addEventListener('click', () => {
				setTutorialModeForContext(context, context.mode === 'pose' ? 'video' : 'pose');
			});
		}
	}

	if (openLivePracticeBtn && dashboardView && livePracticeView) {
		openLivePracticeBtn.addEventListener('click', () => {
			dashboardView.classList.add('hidden');
			livePracticeView.classList.remove('hidden');
		});
	}

	if (backToDashboardBtn && dashboardView && livePracticeView) {
		backToDashboardBtn.addEventListener('click', () => {
			livePracticeView.classList.add('hidden');
			dashboardView.classList.remove('hidden');
		});
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
	if (logoutBtnLive && typeof onLogout === 'function') {
		logoutBtnLive.addEventListener('click', onLogout);
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
	const statusEls = ['statusText', 'liveStatusText'];
	for (const id of statusEls) {
		const el = document.getElementById(id);
		if (el) {
			el.textContent = message;
		}
	}
}

function setReportSourceBadge(meta) {
	const badgeEl = document.getElementById('reportSourceBadge');
	if (!badgeEl) {
		return;
	}

	if (!meta || !meta.source) {
		badgeEl.textContent = 'Awaiting Report';
		badgeEl.className = 'report-source-badge';
		return;
	}

	if (meta.source === 'openrouter') {
		badgeEl.textContent = `OpenRouter${meta.model ? ` (${meta.model})` : ''}`;
		badgeEl.className = 'report-source-badge report-source-openrouter';
		return;
	}

	badgeEl.textContent = meta.reason ? `Fallback (${meta.reason})` : 'Fallback';
	badgeEl.className = 'report-source-badge report-source-fallback';
}

function renderStructuredReportText(text, outputEl) {
	outputEl.innerHTML = '';

	const lines = String(text || '').split('\n');
	let listEl = null;

	const parseInlineMarkdown = (input) => {
		const fragment = document.createDocumentFragment();
		const line = String(input || '');
		const boldRegex = /\*\*(.+?)\*\*/g;
		let cursor = 0;
		let match = boldRegex.exec(line);

		while (match) {
			if (match.index > cursor) {
				fragment.appendChild(document.createTextNode(line.slice(cursor, match.index)));
			}
			const strong = document.createElement('strong');
			strong.textContent = match[1];
			fragment.appendChild(strong);
			cursor = match.index + match[0].length;
			match = boldRegex.exec(line);
		}

		if (cursor < line.length) {
			fragment.appendChild(document.createTextNode(line.slice(cursor)));
		}

		return fragment;
	};

	const appendParagraph = (line) => {
		const paragraph = document.createElement('p');
		paragraph.className = 'report-line';
		paragraph.appendChild(parseInlineMarkdown(line));
		outputEl.appendChild(paragraph);
	};

	const appendHeading = (line) => {
		const heading = document.createElement('h3');
		heading.className = 'report-section-title';
		heading.textContent = line;
		outputEl.appendChild(heading);
	};

	const parseTableCells = (line) => {
		const trimmed = String(line || '').trim();
		const withoutEdgePipes = trimmed.replace(/^\|/, '').replace(/\|$/, '');
		return withoutEdgePipes.split('|').map((cell) => cell.trim());
	};

	const isTableSeparatorLine = (line) => {
		const cells = parseTableCells(line);
		if (!cells.length) {
			return false;
		}
		return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
	};

	const appendMarkdownTable = (tableLines) => {
		if (!Array.isArray(tableLines) || tableLines.length < 2) {
			return;
		}

		const headerCells = parseTableCells(tableLines[0]);
		const bodyLines = tableLines.slice(2);

		const wrap = document.createElement('div');
		wrap.className = 'report-table-wrap';

		const table = document.createElement('table');
		table.className = 'report-table';

		const thead = document.createElement('thead');
		const headerRow = document.createElement('tr');
		for (const cellText of headerCells) {
			const th = document.createElement('th');
			th.textContent = cellText;
			headerRow.appendChild(th);
		}
		thead.appendChild(headerRow);
		table.appendChild(thead);

		const tbody = document.createElement('tbody');
		for (const bodyLine of bodyLines) {
			const cells = parseTableCells(bodyLine);
			if (!cells.length || cells.every((cell) => !cell)) {
				continue;
			}
			const row = document.createElement('tr');
			for (const cellText of cells) {
				const td = document.createElement('td');
				td.textContent = cellText;
				row.appendChild(td);
			}
			tbody.appendChild(row);
		}
		table.appendChild(tbody);

		wrap.appendChild(table);
		outputEl.appendChild(wrap);
	};

	for (let i = 0; i < lines.length; i += 1) {
		const rawLine = lines[i];
		const line = rawLine.trimEnd();
		const cleanLine = line.trim();

		if (!cleanLine) {
			listEl = null;
			const spacer = document.createElement('div');
			spacer.className = 'report-spacer';
			outputEl.appendChild(spacer);
			continue;
		}

		if (/^##\s+/.test(cleanLine)) {
			listEl = null;
			appendHeading(cleanLine.replace(/^##\s+/, ''));
			continue;
		}

		if (/^\d+\)\s+/.test(cleanLine)) {
			listEl = null;
			appendHeading(cleanLine);
			continue;
		}

		if (cleanLine.startsWith('|')) {
			const tableLines = [cleanLine];
			let j = i + 1;
			while (j < lines.length) {
				const nextLine = String(lines[j] || '').trim();
				if (!nextLine.startsWith('|')) {
					break;
				}
				tableLines.push(nextLine);
				j += 1;
			}

			if (tableLines.length >= 2 && isTableSeparatorLine(tableLines[1])) {
				listEl = null;
				appendMarkdownTable(tableLines);
				i = j - 1;
				continue;
			}

			listEl = null;
			appendParagraph(cleanLine);
			i = j - 1;
			continue;
		}

		if (cleanLine.startsWith('- ')) {
			if (!listEl) {
				listEl = document.createElement('ul');
				listEl.className = 'report-list';
				outputEl.appendChild(listEl);
			}
			const item = document.createElement('li');
			item.appendChild(parseInlineMarkdown(cleanLine.slice(2)));
			listEl.appendChild(item);
			continue;
		}

		listEl = null;
		appendParagraph(cleanLine);
	}

	if (!outputEl.textContent?.trim()) {
		outputEl.textContent = 'No report generated yet.';
	}
}

export function renderReport(text, finalReport = null, meta = null) {
	const outputEl = document.getElementById('reportOutput');
	if (outputEl) {
		renderStructuredReportText(text, outputEl);
	}
	setReportSourceBadge(meta);

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
	const welcomeEls = ['welcomeText', 'welcomeTextLive'];
	for (const id of welcomeEls) {
		const el = document.getElementById(id);
		if (el) {
			el.textContent = text;
		}
	}
}

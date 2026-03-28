import { useEffect, useState } from 'react';
import LegacyBootstrap from './LegacyBootstrap.jsx';

export default function App() {
	const [asanaCatalog] = useState([
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
			photoLinks: [
				'/src/step 1 konasana image updated.png',
				'/src/step 2 konasana image updated.png',
				'/src/step 3 konasana image updated.png',
			],
			videoLinks: ['/poses/konasana-video.mp4'],
			tutorialCaption: 'Follow this guided Konasana demo video.',
			anatomicalFocus: {
				targetMuscles: '<ul><li><b>Obliques (side abdominal muscles)</b> – primary muscles engaged during the side bend</li><li><b>Core muscles</b> – stabilize the body and maintain balance</li><li><b>Shoulders & arms</b> – support the raised arm and help in stretching</li><li><b>Hamstrings & inner thighs</b> – lightly stretched due to wide stance</li></ul>',
				healthBenefits: '<ul><li>Improves flexibility of the spine, especially side bending</li><li>Strengthens the core and waist muscles</li><li>Enhances digestion by compressing and stretching abdominal organs</li><li>Improves posture and balance</li><li>Helps in reducing stiffness in the back and sides</li></ul>',
				precautions: '<ul><li>Avoid if you have lower back injury or severe spinal issues</li><li>Do not bend forward or backward — only sideways bending should be done</li><li>Avoid overstretching; go only as far as comfortable</li><li>Keep breathing normal and steady</li></ul>',
			},
			tutorialSteps: [
				{
					title: 'Step 1',
					caption: 'Stand tall with feet apart and raise one arm straight overhead.',
					videoUrl: '/poses/konasana-video.mp4',
				},
				{
					title: 'Step 2',
					caption: 'Bend sideways from the waist while keeping chest open and legs straight.',
					videoUrl: '/poses/konasana-video.mp4',
				},
				{
					title: 'Step 3',
					caption: 'Hold the posture with steady breathing, then return slowly to center.',
					videoUrl: '/poses/konasana-video.mp4',
				},
			],
		},
		{
			id: 'trikonasana',
			name: 'Trikonasana',
			description: 'Details not available.',
			faqs: ['Details not available.'],
			photoLinks: [],
			videoLinks: [],
			tutorialCaption: 'Details not available.',
		},
		{
			id: 'vrikshasana',
			name: 'Vrikshasana',
			description: 'Details not available.',
			faqs: ['Details not available.'],
			photoLinks: [],
			videoLinks: [],
			tutorialCaption: 'Details not available.',
		},
	]);

	useEffect(() => {
		window.__yogmitraAsanas = asanaCatalog;
	}, [asanaCatalog]);

	return (
		<>
			<div className="bg-shape bg-shape-a"></div>
			<div className="bg-shape bg-shape-b"></div>

			<section id="loginView" className="login-view">
				<div className="login-card">
					<div className="login-brand">
						<img src="/logo.png" alt="YogMitra logo" className="login-logo" />
						<h1>YogMitra</h1>
					</div>
					<p>AI-based yoga posture analysis and guided practice.</p>
					<div className="auth-tabs" role="tablist" aria-label="Authentication mode">
						<button id="signInTab" className="auth-tab active" type="button" role="tab" aria-selected="true">Sign In</button>
						<button id="signUpTab" className="auth-tab" type="button" role="tab" aria-selected="false">Sign Up</button>
					</div>
					<form id="loginForm">
						<label id="fullNameLabel" className="hidden">Full Name
							<input id="fullNameInput" type="text" placeholder="Your name" />
						</label>
						<label>Email
							<input id="emailInput" type="email" placeholder="you@example.com" required />
						</label>
						<label>Password
							<input id="passwordInput" type="password" placeholder="••••••••" required />
						</label>
						<label id="confirmPasswordLabel" className="hidden">Confirm Password
							<input id="confirmPasswordInput" type="password" placeholder="••••••••" />
						</label>
						<p id="authError" className="auth-error hidden" aria-live="polite"></p>
						<button id="authSubmitBtn" type="submit">Login</button>
					</form>
					<button id="authSwitchBtn" className="secondary-link" type="button">New user? Create an account</button>
				</div>
			</section>

			<div id="profileModal" className="modal hidden">
				<div className="modal-card">
					<h2>Complete Your Profile</h2>
					<p>Add indirect parameters for personalized analysis.</p>
					<form id="profileForm">
						<label>Age
							<input id="profileAge" type="number" min="20" max="60" defaultValue="30" required />
						</label>
						<label>Flexibility
							<select id="profileFlexibility" defaultValue="medium">
								<option value="low">Low</option>
								<option value="medium">Medium</option>
								<option value="high">High</option>
							</select>
						</label>
						<label>Experience
							<select id="profileExperience" defaultValue="beginner">
								<option value="beginner">Beginner</option>
								<option value="intermediate">Intermediate</option>
								<option value="advanced">Advanced</option>
							</select>
						</label>
						<button type="submit">Open Dashboard</button>
					</form>
				</div>
			</div>

			<div id="sessionFeedbackModal" className="modal hidden">
				<div className="modal-card feedback-modal-card">
					<h2>Session Feedback</h2>
					<p>Help us personalize your next session.</p>
					<form id="sessionFeedbackForm">
						<label>Overall session rating
							<select id="feedbackOverallRating" defaultValue="4" required>
								<option value="5">5 - Excellent</option>
								<option value="4">4 - Good</option>
								<option value="3">3 - Average</option>
								<option value="2">2 - Difficult</option>
								<option value="1">1 - Poor</option>
							</select>
						</label>
						<label>How helpful were live tips and chatbot guidance?
							<select id="feedbackCoachHelpfulness" defaultValue="4" required>
								<option value="5">5 - Very helpful</option>
								<option value="4">4 - Helpful</option>
								<option value="3">3 - Neutral</option>
								<option value="2">2 - Slightly helpful</option>
								<option value="1">1 - Not helpful</option>
							</select>
						</label>
						<label>Difficulty today
							<select id="feedbackDifficulty" defaultValue="moderate" required>
								<option value="easy">Easy</option>
								<option value="moderate">Moderate</option>
								<option value="hard">Hard</option>
							</select>
						</label>
						<label>Confidence before session
							<select id="feedbackConfidenceBefore" defaultValue="3" required>
								<option value="5">5 - Very confident</option>
								<option value="4">4 - Confident</option>
								<option value="3">3 - Somewhat confident</option>
								<option value="2">2 - Low confidence</option>
								<option value="1">1 - Not confident</option>
							</select>
						</label>
						<label>Confidence after session
							<select id="feedbackConfidence" defaultValue="3" required>
								<option value="5">5 - Very confident</option>
								<option value="4">4 - Confident</option>
								<option value="3">3 - Somewhat confident</option>
								<option value="2">2 - Low confidence</option>
								<option value="1">1 - Not confident</option>
							</select>
						</label>
						<label>Any discomfort or pain?
							<select id="feedbackDiscomfort" defaultValue="none" required>
								<option value="none">No discomfort</option>
								<option value="mild">Mild discomfort</option>
								<option value="pain">Pain</option>
							</select>
						</label>
						<label id="feedbackPainAreaWrap" className="hidden">Where did you feel it most?
							<select id="feedbackPainArea" defaultValue="shoulder">
								<option value="neck">Neck</option>
								<option value="shoulder">Shoulder</option>
								<option value="back">Back</option>
								<option value="hip">Hip</option>
								<option value="knee">Knee</option>
								<option value="other">Other</option>
							</select>
						</label>
						<label id="feedbackPainIntensityWrap" className="hidden">How intense was the discomfort? (0-10)
							<select id="feedbackPainIntensity" defaultValue="3">
								<option value="0">0 - No pain</option>
								<option value="1">1</option>
								<option value="2">2</option>
								<option value="3">3</option>
								<option value="4">4</option>
								<option value="5">5</option>
								<option value="6">6</option>
								<option value="7">7</option>
								<option value="8">8</option>
								<option value="9">9</option>
								<option value="10">10 - Very intense</option>
							</select>
						</label>
						<label>Which step felt hardest today?
							<select id="feedbackHardestStep" defaultValue="step2" required>
								<option value="step1">Step 1</option>
								<option value="step2">Step 2</option>
								<option value="step3">Step 3</option>
								<option value="all_steps">All steps felt hard</option>
							</select>
						</label>
						<label>What correction do you want to focus on next?
							<select id="feedbackCorrectionFocus" defaultValue="spine_alignment" required>
								<option value="arm_alignment">Arm alignment</option>
								<option value="spine_alignment">Spine and side-bend alignment</option>
								<option value="hip_stability">Hip stability</option>
								<option value="knee_stability">Knee stability</option>
								<option value="breathing_control">Breathing control</option>
								<option value="timing_control">Timing and transitions</option>
							</select>
						</label>
						<label>Main challenge faced
							<select id="feedbackMainChallenge" defaultValue="holding_pose" required>
								<option value="no_difficulty">No major difficulty</option>
								<option value="balance">Maintaining balance</option>
								<option value="holding_pose">Holding final pose</option>
								<option value="timing">Following timing</option>
								<option value="instructions">Understanding instructions</option>
								<option value="camera_tracking">Camera tracking</option>
								<option value="other">Other</option>
							</select>
						</label>
						<label>Primary goal for next session
							<select id="feedbackNextSessionGoal" defaultValue="improve_accuracy" required>
								<option value="improve_accuracy">Improve posture accuracy</option>
								<option value="reduce_pain">Reduce discomfort and pain</option>
								<option value="better_balance">Improve balance</option>
								<option value="hold_longer">Hold final pose longer</option>
								<option value="better_timing">Improve timing consistency</option>
							</select>
						</label>
						<label>Anything to improve for next session? (optional)
							<input id="feedbackComment" type="text" maxLength={220} placeholder="Your suggestion" />
						</label>
						<div className="feedback-modal-actions">
							<button id="feedbackSkipBtn" type="button" className="secondary-nav-btn">Skip</button>
							<button type="submit">Submit Feedback</button>
						</div>
					</form>
				</div>
			</div>

			<main id="dashboardView" className="dashboard hidden">
				<header className="header">
					<div className="header-top">
						<div className="header-brand">
							<img src="/logo.png" alt="YogMitra logo" className="dashboard-logo" />
							<h1>YogMitra Dashboard</h1>
						</div>
						<button id="logoutBtn" className="logout-btn" type="button">Logout</button>
					</div>
					<p id="welcomeText">Welcome</p>
					<p id="statusText" className="status-text">Initializing...</p>
				</header>

				<div className="dashboard-grid">
					<aside className="panel left-panel">
						<h2>Asana Selection</h2>
						<label>Select Asana
							<select id="asanaSelect" defaultValue={asanaCatalog[0]?.name || 'Konasana'}>
								{asanaCatalog.map((asana) => (
									<option key={asana.id} value={asana.name}>{asana.name}</option>
								))}
							</select>
						</label>
						<div className="info-box">
							<h3>Description</h3>
							<p id="asanaDescription"></p>
						</div>
						<div className="info-box">
							<h3>Anatomical Focus</h3>
							<div id="anatomicalFocusContainer" className="focus-container"></div>
						</div>
						<div className="info-box">
							<h3>FAQ</h3>
							<ul id="faqList"></ul>
				</div>
			</aside>

					<section className="panel right-panel">
						<div className="tutorial-wrap">
							<div className="section-head">
								<h2>Instructor Tutorial</h2>
								<div className="tutorial-toggle">
									<button id="tutorialModeToggleDashboard" className="tutorial-toggle-btn" type="button" aria-label="Toggle between pose and video tutorial on dashboard">Show Video</button>
								</div>
							</div>
							<div className="tutorial-media-container">
								<div id="tutorialPoseGalleryDashboard" className="tutorial-pose-gallery"></div>
								<video id="tutorialVideoDashboard" className="hidden" controls playsInline></video>
							</div>
							<p id="tutorialCaptionDashboard"></p>
						</div>

						<div className="info-box live-practice-link-box">
							<h3>Live Practice</h3>
							<p>Open the dedicated practice page for instructor tutorial, session controls, analysis, and webcam posture tracking.</p>
							<button id="openLivePracticeBtn" type="button" className="open-live-practice-btn">Open Live Practice Page</button>
						</div>
					</section>
				</div>
			</main>

			<main id="livePracticeView" className="dashboard hidden live-practice-view">
				<p id="welcomeTextLive" className="live-hidden-meta">Welcome</p>
				<p id="liveStatusText" className="status-text live-hidden-meta">Initializing...</p>

				<section className="live-session-layout">
					<div className="live-top-row">
						<div className="panel live-screen-card instructor-card">
							<div className="section-head">
								<h2>Instructor Video</h2>
								<div className="tutorial-toggle">
									<button id="tutorialModeToggle" className="tutorial-toggle-btn" type="button" aria-label="Toggle between pose and video tutorial">Show Video</button>
								</div>
							</div>
							<div className="tutorial-media-container live-tutorial-media">
								<div id="tutorialPoseGallery" className="tutorial-pose-gallery"></div>
								<video id="tutorialVideo" className="hidden" controls playsInline></video>
							</div>
							<p id="tutorialCaption"></p>
						</div>

						<div className="panel live-screen-card">
							<h3>User (Raw)</h3>
							<video id="rawVideo" autoPlay playsInline muted></video>
						</div>

						<div className="panel live-screen-card">
							<h3>User (Markers)</h3>
							<div className="annotated-wrap">
								<video id="markedVideo" autoPlay playsInline muted></video>
								<canvas id="poseCanvas"></canvas>
							</div>
						</div>
					</div>

					<div className="live-session-controls-row">
						<button id="startSessionBtn" type="button">Start Session</button>
						<button id="endSessionBtn" type="button" disabled>End Session</button>
					</div>

					<p className="camera-guide-text">Keep your full body visible: head, both palms, and both feet.</p>

					<div className="live-stats-row">
						<div className="panel live-stat-card">
							<span>Prediction</span>
							<strong id="predictionResult">-</strong>
						</div>
						<div className="panel live-stat-card">
							<span>Confidence</span>
							<strong id="predictionConfidence">-</strong>
						</div>
						<div className="panel live-stat-card">
							<span>Score (0-100)</span>
							<strong id="poseScore">-</strong>
						</div>
						<div className="panel live-stat-card live-feedback-card">
							<span>Feedback</span>
							<ul id="feedbackList"></ul>
						</div>
					</div>

					<div className="panel live-support-row">
						<div className="analysis-row session-summary-row">
							<span>Session Summary</span>
							<div id="sessionSummary" className="session-summary-text">No session completed yet.</div>
						</div>
						<div className="analysis-row session-summary-row">
							<span>Live Coach</span>
							<div id="liveCoachTip" className="session-summary-text">Start session to get real-time posture cues.</div>
						</div>
						<div className="webcam-report-actions">
							<button id="openReportPageBtn" type="button">Open Report Page</button>
						</div>
					</div>
				</section>
			</main>

			<main id="reportView" className="dashboard hidden">
				<header className="header">
					<div className="header-top">
						<div className="header-brand">
							<img src="/logo.png" alt="YogMitra logo" className="dashboard-logo" />
							<h1>Session Report</h1>
						</div>
						<div className="live-practice-header-actions">
							<button id="backToLivePracticeFromReportBtn" type="button" className="secondary-nav-btn">Back to Live Practice</button>
							<button id="backToDashboardFromReportBtn" type="button" className="secondary-nav-btn">Back to Dashboard</button>
							<button id="logoutBtnReport" className="logout-btn" type="button">Logout</button>
						</div>
					</div>
					<p className="status-text">Review your generated report. Open assistant only when needed.</p>
				</header>

				<div className="report-only-grid">
					<section className="panel live-left-panel">
						<div className="webcam-report-actions">
							<button id="downloadReportBtn" type="button" disabled>Download Report</button>
						</div>

						<div id="reportLoadingState" className="report-loading hidden" aria-live="polite">
							<div className="report-loading-spinner" aria-hidden="true"></div>
							<p id="reportLoadingText">Generating your personalized report...</p>
						</div>

						<div className="report-box">
							<div className="report-title-row">
								<h2>AI Posture Report</h2>
								<span id="reportSourceBadge" className="report-source-badge">Awaiting Report</span>
							</div>
							<div id="reportOutput" className="report-output">No report generated yet.</div>
							<div id="reportVisuals" className="report-visuals"></div>
						</div>
					</section>
				</div>

				<button id="reportAssistantToggle" type="button" className="report-assistant-toggle hidden" aria-label="Open assistant" aria-expanded="false">Assistant</button>

				<div id="reportAssistantPanel" className="report-assistant-panel hidden" aria-live="polite">
					<div className="chatbot-box">
						<div className="chatbot-head">
							<h2>Asana Assistant</h2>
							<p>Uses your latest report and feedback for personalized answers.</p>
						</div>
						<div id="chatbotMessages" className="chatbot-messages" aria-live="polite">
							<div className="chat-msg chat-msg-bot">Hi! Ask me anything about your latest report, corrections, and next-step practice.</div>
						</div>
						<form id="chatbotForm" className="chatbot-form">
							<input id="chatbotInput" type="text" placeholder="Ask based on my latest session..." maxLength={500} required />
							<button id="chatbotSendBtn" type="submit">Send</button>
						</form>
						<button id="reportAssistantClose" type="button" className="secondary-nav-btn">Close</button>
					</div>
				</div>
			</main>

			<LegacyBootstrap />
		</>
	);
}

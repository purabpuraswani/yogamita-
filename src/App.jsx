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
				'/poses/pose-1.png',
				'/poses/pose-2.png',
				'/poses/pose-3.png',
			],
			videoLinks: ['https://www.w3schools.com/html/mov_bbb.mp4'],
			tutorialCaption: 'Follow this guided Konasana demo video.',
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
							<h3>FAQ</h3>
							<ul id="faqList"></ul>
						</div>
					</aside>

					<section className="panel right-panel">
						<div className="tutorial-wrap">
							<div className="section-head">
								<h2>Instructor Tutorial</h2>
								<div className="tutorial-toggle">
									<button id="tutorialModeToggle" className="tutorial-toggle-btn" type="button" aria-label="Toggle between pose and video tutorial">Show Video</button>
								</div>
							</div>
							<div className="tutorial-media-container">
								<div id="tutorialPoseGallery" className="tutorial-pose-gallery"></div>
								<video id="tutorialVideo" className="hidden" controls playsInline></video>
							</div>
							<p id="tutorialCaption"></p>
						</div>

						<div className="practice-wrap">
							<div className="section-head">
								<h2>Live Practice</h2>
							</div>
							<div className="practice-grid">
								<div className="video-card">
									<h3>Webcam (Raw)</h3>
									<video id="rawVideo" autoPlay playsInline muted></video>
								</div>
								<div className="video-card">
									<h3>Webcam (MoveNet Markers)</h3>
									<div className="annotated-wrap">
										<video id="markedVideo" autoPlay playsInline muted></video>
										<canvas id="poseCanvas"></canvas>
									</div>
								</div>
							</div>

							<div className="analysis-box">
								<div className="analysis-row">
									<span>Prediction</span>
									<strong id="predictionResult">-</strong>
								</div>
								<div className="analysis-row">
									<span>Confidence</span>
									<strong id="predictionConfidence">-</strong>
								</div>
								<div className="analysis-row">
									<span>Score (0-10)</span>
									<strong id="poseScore">-</strong>
								</div>
								<div className="analysis-row feedback-row">
									<span>Feedback</span>
									<ul id="feedbackList"></ul>
								</div>
								<div className="analysis-row session-controls">
									<button id="startSessionBtn" type="button">Start Session</button>
									<button id="endSessionBtn" type="button" disabled>End Session</button>
								</div>
								<div className="analysis-row session-summary-row">
									<span>Session Summary</span>
									<div id="sessionSummary" className="session-summary-text">No session completed yet.</div>
								</div>
								<div className="analysis-row session-summary-row">
									<span>Live Coach</span>
									<div id="liveCoachTip" className="session-summary-text">Start session to get real-time posture cues.</div>
								</div>
								<div className="analysis-row report-controls">
									<button id="generateReportBtn" type="button">Generate Report</button>
									<button id="downloadReportBtn" type="button" disabled>Download Report</button>
								</div>
							</div>
						</div>

						<div className="report-box">
							<h2>AI Posture Report</h2>
							<pre id="reportOutput">No report generated yet.</pre>
						</div>
					</section>
				</div>
			</main>

			<LegacyBootstrap />
		</>
	);
}

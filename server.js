const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 8000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

function buildPrompt(data) {
	const session = data.session || {};
	const improvements = Array.isArray(session.improvements) ? session.improvements : [];

	return [
		'You are an expert yoga coach and biomechanics analyst.',
		'Write a detailed, practical, and actionable posture report based ONLY on the provided session data.',
		'Use clear plain English for a learner. Avoid generic filler.',
		'Avoid implementation terms such as "frame", "model", or "classification pipeline" in the final report.',
		'',
		'Required output format (use these exact section headers):',
		'1) Session Performance Summary',
		'2) Technique Breakdown',
		'3) What Needs Improvement',
		'4) Corrective Drills (Step-by-step)',
		'5) Safety and Breathing Checks',
		'6) Next Session Target Metrics',
		'7) 7-Day Progressive Practice Plan',
		'',
		'Quality requirements:',
		'- Minimum 450 words.',
		'- Include specific numeric references from the session (consistency %, visibility %, score, duration).',
		'- In section 3, provide at least 5 concrete improvement points.',
		'- In section 4, provide at least 4 drills with duration/reps and exact execution cues.',
		'- In section 6, define measurable targets for score, consistency ratio, and visibility quality ratio.',
		'- Keep advice age-appropriate and experience-aware.',
		'',
		'Input data:',
		`- Asana: ${data.asana}`,
		`- Final prediction: ${data.prediction}`,
		`- Average score: ${Number(data.score).toFixed(2)}/10`,
		`- Age: ${data.age}`,
		`- Flexibility level: ${data.flexibility}`,
		`- Experience level: ${data.experience}`,
		`- Session duration: ${session.duration || 'unknown'}`,
		`- Pose checks captured: ${session.totalCapturedFrames ?? 'unknown'}`,
		`- Pose checks analyzed: ${session.totalAnalyzedFrames ?? 'unknown'}`,
		`- Low-visibility checks: ${session.skippedFrames ?? 'unknown'}`,
		`- Stable checks: ${session.correctFrames ?? 'unknown'}`,
		`- Needs-adjustment checks: ${(Number(session.moderateFrames) || 0) + (Number(session.incorrectFrames) || 0)}`,
		`- Suggested improvement cues from system: ${improvements.join('; ') || 'none'}`,
		`- Additional feedback points: ${(data.feedback || []).join('; ')}`,
	].join('\n');
}

function fallbackReport(data) {
	const session = data.session || {};
	const improvements = Array.isArray(session.improvements) ? session.improvements : [];
	const avgScore = Number(data.score) || 0;
	const totalAnalyzed = Number(session.totalAnalyzedFrames) || 0;
	const correctFrames = Number(session.correctFrames) || 0;
	const moderateFrames = Number(session.moderateFrames) || 0;
	const incorrectFrames = Number(session.incorrectFrames) || 0;
	const skippedFrames = Number(session.skippedFrames) || 0;
	const totalCaptured = Number(session.totalCapturedFrames) || (totalAnalyzed + skippedFrames);
	const correctRatio = totalAnalyzed ? ((correctFrames / totalAnalyzed) * 100).toFixed(1) : '0.0';
	const skippedRatio = totalCaptured ? ((skippedFrames / totalCaptured) * 100).toFixed(1) : '0.0';
	const targetScore = Math.min(10, avgScore + 1.0).toFixed(1);

	return [
		'1) Session Performance Summary',
		`- Asana: ${data.asana}`,
		`- Final Result: ${data.prediction}`,
		`- Average Score: ${avgScore.toFixed(1)} / 10`,
		`- Duration: ${session.duration || 'unknown'}`,
		`- Session consistency: ${correctRatio}%`,
		`- Visibility quality: ${(100 - Number(skippedRatio)).toFixed(1)}%`,
		'',
		'2) Technique Breakdown',
		`- Consistency ratio: ${correctRatio}% (higher is better for stable posture).`,
		'- Main focus remains side bend depth with chest openness and arm-over-ear alignment.',
		'- Maintain knee extension and centered weight over ankles to reduce drift.',
		'',
		'3) What Needs Improvement',
		...(improvements.length
			? improvements.map((item) => `- ${item}`)
			: [
				'- Keep full body visible in frame to reduce skipped analysis windows.',
				'- Lift top arm closer to ear and keep ribcage open during the bend.',
				'- Increase hold stability by slowing entry and exit transitions.',
			]),
		'',
		'4) Corrective Drills (Step-by-step)',
		'- Wall-assisted side bend hold: 3 sets x 20-30 sec each side. Keep shoulder, hip, and heel contact where possible.',
		'- Overhead reach drill: 2 sets x 10 reps each side. Reach long first, then bend; avoid shoulder shrugging.',
		'- Static balance drill: 3 sets x 25 sec. Keep pelvis centered over ankles with smooth nasal breathing.',
		'- Mirror form check: 2 rounds x 60 sec. Watch for knee bend and chest collapse; correct immediately.',
		'',
		'5) Safety and Breathing Checks',
		'- Do not force range; stop before pain and keep neck relaxed.',
		'- Use inhale to lengthen spine and exhale to deepen bend gradually.',
		'- If dizziness occurs, return to neutral stance and rest.',
		'',
		'6) Next Session Target Metrics',
		`- Target average score: >= ${targetScore} / 10.`,
		`- Target consistency ratio: >= ${Math.min(95, Number(correctRatio) + 12).toFixed(0)}%.`,
		`- Target visibility quality: >= ${Math.min(98, 100 - Math.max(5, Number(skippedRatio) - 8)).toFixed(0)}%.`,
		'',
		'7) 7-Day Progressive Practice Plan',
		'- Days 1-2: 3 x 20 sec holds each side, focus only on alignment.',
		'- Days 3-4: 3 x 30 sec holds each side, add smoother transitions.',
		'- Days 5-6: 4 x 30 sec holds each side, aim for lower skipped frames.',
		'- Day 7: Assessment session, compare frame ratios and average score against targets.',
	].join('\n');
}

app.post('/api/report', async (req, res) => {
	try {
		const payload = req.body?.data;
		if (!payload) {
			res.status(400).send('Missing report payload.');
			return;
		}

		if (!GEMINI_API_KEY) {
			res.json({
				report: `${fallbackReport(payload)}\n\nGemini is not configured on server. Set GEMINI_API_KEY and restart server.`,
			});
			return;
		}

		const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
		let lastErrorStatus = 0;
		let lastErrorDetails = 'Unknown Gemini API error.';

		for (const model of models) {
			const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ parts: [{ text: buildPrompt(payload) }] }],
					generationConfig: {
						temperature: 0.2,
						topP: 0.9,
						maxOutputTokens: 1400,
					},
				}),
			});

			if (response.ok) {
				const result = await response.json();
				const text = result?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim();
				if (text) {
					res.json({ report: text, source: 'gemini', model });
					return;
				}
				lastErrorStatus = 502;
				lastErrorDetails = `Gemini returned empty response for model ${model}.`;
				continue;
			}

			lastErrorStatus = response.status;
			lastErrorDetails = await response.text();
		}

		const quotaLikely = lastErrorStatus === 429 || /quota|resource_exhausted|rate/i.test(lastErrorDetails);
		const fallbackNote = quotaLikely
			? 'Gemini quota/rate limit reached. Showing detailed local coaching report instead.'
			: 'Gemini is temporarily unavailable. Showing detailed local coaching report instead.';

		res.json({
			report: `${fallbackReport(payload)}\n\n${fallbackNote}`,
			source: 'fallback',
			reason: quotaLikely ? 'quota_exceeded' : 'gemini_unavailable',
		});
	} catch (error) {
		res.json({
			report: `${fallbackReport(req.body?.data || {})}\n\nServer error while contacting Gemini: ${error.message}\nShowing detailed local coaching report instead.`,
			source: 'fallback',
			reason: 'server_error',
		});
	}
});

app.use((_req, res) => {
	res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
	console.log(`YogMitra server running at http://localhost:${PORT}`);
});

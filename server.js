const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const PORT = process.env.PORT || 8000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const app = express();
const DIST_DIR = path.join(__dirname, 'dist');
const HAS_DIST_BUILD = fs.existsSync(path.join(DIST_DIR, 'index.html'));

app.use(express.json({ limit: '1mb' }));
if (HAS_DIST_BUILD) {
	app.use(express.static(DIST_DIR));
} else {
	app.use(express.static(__dirname));
}

app.use('/models', express.static(path.join(__dirname, 'models')));
app.use('/datasets', express.static(path.join(__dirname, 'datasets')));

function buildPrompt(data) {
	const session = data.session || {};
	const improvements = Array.isArray(session.improvements) ? session.improvements : [];
	const timing = session.timingAnalysis || {};
	const angle = session.angleAnalysis || {};
	const scores = session.sessionScores || {};
	const perStep = scores.perStep || {};

	const stepKeys = ['step1', 'step2', 'step3'];
	const stepLines = stepKeys.map((stepKey) => {
		const stepAngle = angle?.steps?.[stepKey] || {};
		const stepScore = perStep?.[stepKey] || {};
		const userTime = stepKey === 'step1' ? timing?.userStep1Time : stepKey === 'step2' ? timing?.userStep2Time : timing?.userStep3Time;
		const idealTime = stepKey === 'step1' ? timing?.idealStep1Time : stepKey === 'step2' ? timing?.idealStep2Time : timing?.idealStep3Time;
		const delay = stepKey === 'step1' ? timing?.delayStep1 : stepKey === 'step2' ? timing?.delayStep2 : timing?.delayStep3;
		return `${stepKey}: angleAvg=${Number.isFinite(stepAngle?.averageError) ? `${Number(stepAngle.averageError).toFixed(2)}°` : 'N/A'}, anglePerf=${stepAngle?.performance || 'Unknown'}, userTime=${Number.isFinite(userTime) ? `${Number(userTime).toFixed(2)}s` : 'N/A'}, idealTime=${Number.isFinite(idealTime) ? `${Number(idealTime).toFixed(2)}s` : 'N/A'}, delay=${Number.isFinite(delay) ? `${Number(delay).toFixed(2)}s` : 'N/A'}, weightedStepScore=${Number.isFinite(stepScore?.weightedScore) ? Number(stepScore.weightedScore).toFixed(2) : 'N/A'}`;
	});

	return [
		'You are an expert yoga coach and biomechanics analyst.',
		'Write a detailed, practical, and actionable posture report based ONLY on the provided session data.',
		'Use clear plain English for a learner. Avoid generic filler and repetitive phrasing.',
		'Avoid implementation terms such as "frame", "model", or "classification pipeline" in the final report.',
		'If any metric is missing, write "Data unavailable" for that metric instead of guessing.',
		'',
		'Required output format (Markdown, use these exact section headers):',
		'## 1) Session Performance Summary',
		'## 2) Step-wise Technique Breakdown',
		'## 3) Angle and Timing Comparison (User vs Ideal)',
		'## 4) What Needs Improvement',
		'## 5) Corrective Drills (Step-by-step)',
		'## 6) Safety and Breathing Checks',
		'## 7) Next Session Target Metrics',
		'## 8) 7-Day Progressive Practice Plan',
		'',
		'Quality requirements:',
		'- 450 to 700 words.',
		'- Include specific numeric references from the session (consistency %, visibility %, score, duration, angle errors, timing delays).',
		'- In section 2, include 3 short subsections (Step 1, Step 2, Step 3) with concise observations.',
		'- In section 3, explicitly compare user metrics against ideal for each step and state which step is most improved and most problematic.',
		'- In section 4, provide at least 5 concrete improvement points.',
		'- In section 5, provide at least 4 drills with duration/reps and exact execution cues.',
		'- In section 7, define measurable targets for score, consistency ratio, and visibility quality ratio.',
		'- Present at least one compact Markdown table summarizing step-wise angle and timing deltas.',
		'- Keep advice age-appropriate and experience-aware.',
		'',
		'Input data:',
		`- Asana: ${data.asana}`,
		`- Final prediction: ${data.prediction}`,
		`- Average score: ${Number(data.score).toFixed(2)}/100`,
		`- Age: ${data.age}`,
		`- Flexibility level: ${data.flexibility}`,
		`- Experience level: ${data.experience}`,
		`- Session duration: ${session.duration || 'unknown'}`,
		`- Pose checks captured: ${session.totalCapturedFrames ?? 'unknown'}`,
		`- Pose checks analyzed: ${session.totalAnalyzedFrames ?? 'unknown'}`,
		`- Low-visibility checks: ${session.skippedFrames ?? 'unknown'}`,
		`- Stable checks: ${session.correctFrames ?? 'unknown'}`,
		`- Needs-adjustment checks: ${(Number(session.moderateFrames) || 0) + (Number(session.incorrectFrames) || 0)}`,
		`- Overall angle average error: ${Number.isFinite(angle?.overallAverageError) ? `${Number(angle.overallAverageError).toFixed(2)}°` : 'unknown'}`,
		`- Overall angle performance: ${angle?.overallPerformance || 'unknown'}`,
		`- Overall weighted score: ${Number.isFinite(scores?.overallScore) ? Number(scores.overallScore).toFixed(2) : 'unknown'}`,
		`- Step-wise analytics: ${stepLines.join(' || ')}`,
		`- Suggested improvement cues from system: ${improvements.join('; ') || 'none'}`,
		`- Additional feedback points: ${(data.feedback || []).join('; ')}`,
	].join('\n');
}

function fallbackReport(data) {
	const session = data.session || {};
	const improvements = Array.isArray(session.improvements) ? session.improvements : [];
	const timing = session.timingAnalysis || {};
	const angle = session.angleAnalysis || {};
	const scores = session.sessionScores || {};
	const avgScore = Number(data.score) || 0;
	const totalAnalyzed = Number(session.totalAnalyzedFrames) || 0;
	const correctFrames = Number(session.correctFrames) || 0;
	const moderateFrames = Number(session.moderateFrames) || 0;
	const incorrectFrames = Number(session.incorrectFrames) || 0;
	const skippedFrames = Number(session.skippedFrames) || 0;
	const totalCaptured = Number(session.totalCapturedFrames) || (totalAnalyzed + skippedFrames);
	const correctRatio = totalAnalyzed ? ((correctFrames / totalAnalyzed) * 100).toFixed(1) : '0.0';
	const skippedRatio = totalCaptured ? ((skippedFrames / totalCaptured) * 100).toFixed(1) : '0.0';
	const targetScore = Math.min(100, avgScore + 8.0).toFixed(1);
	const visibilityQuality = (100 - Number(skippedRatio)).toFixed(1);
	const overallAngleError = Number.isFinite(angle?.overallAverageError) ? Number(angle.overallAverageError).toFixed(2) : 'N/A';
	const overallAnglePerf = angle?.overallPerformance || 'Unknown';
	const overallWeighted = Number.isFinite(scores?.overallScore) ? Number(scores.overallScore).toFixed(2) : 'N/A';

	const stepRows = ['step1', 'step2', 'step3'].map((stepKey) => {
		const stepAngle = angle?.steps?.[stepKey] || {};
		const userTime = stepKey === 'step1' ? timing?.userStep1Time : stepKey === 'step2' ? timing?.userStep2Time : timing?.userStep3Time;
		const idealTime = stepKey === 'step1' ? timing?.idealStep1Time : stepKey === 'step2' ? timing?.idealStep2Time : timing?.idealStep3Time;
		const delay = stepKey === 'step1' ? timing?.delayStep1 : stepKey === 'step2' ? timing?.delayStep2 : timing?.delayStep3;
		const stepScore = scores?.perStep?.[stepKey]?.weightedScore;
		const angleAvg = Number.isFinite(stepAngle?.averageError) ? `${Number(stepAngle.averageError).toFixed(2)}°` : 'N/A';
		const perf = stepAngle?.performance || 'Unknown';
		const usr = Number.isFinite(userTime) ? `${Number(userTime).toFixed(2)}s` : 'N/A';
		const ideal = Number.isFinite(idealTime) ? `${Number(idealTime).toFixed(2)}s` : 'N/A';
		const dly = Number.isFinite(delay) ? `${Number(delay).toFixed(2)}s` : 'N/A';
		const weighted = Number.isFinite(stepScore) ? Number(stepScore).toFixed(2) : 'N/A';
		return `| ${stepKey.toUpperCase()} | ${angleAvg} (${perf}) | ${usr} | ${ideal} | ${dly} | ${weighted} |`;
	});

	return [
		'## 1) Session Performance Summary',
		`- Asana: ${data.asana}`,
		`- Final Result: ${data.prediction}`,
		`- Average Score: ${avgScore.toFixed(1)} / 100`,
		`- Duration: ${session.duration || 'unknown'}`,
		`- Session consistency: ${correctRatio}%`,
		`- Visibility quality: ${visibilityQuality}%`,
		`- Overall angle quality: ${overallAnglePerf} (${overallAngleError} average error)`,
		`- Overall weighted analytics score: ${overallWeighted}`,
		'',
		'## 2) Step-wise Technique Breakdown',
		'| Step | Angle vs Ideal | User Time | Ideal Time | Delay | Weighted Score |',
		'|---|---|---:|---:|---:|---:|',
		...stepRows,
		'',
		'## 3) Angle and Timing Comparison (User vs Ideal)',
		`- Step 1 delay: ${Number.isFinite(timing?.delayStep1) ? `${Number(timing.delayStep1).toFixed(2)}s` : 'N/A'}`,
		`- Step 2 delay: ${Number.isFinite(timing?.delayStep2) ? `${Number(timing.delayStep2).toFixed(2)}s` : 'N/A'}`,
		`- Step 3 delay: ${Number.isFinite(timing?.delayStep3) ? `${Number(timing.delayStep3).toFixed(2)}s` : 'N/A'}`,
		'- Priority order: improve the step with highest angle error and largest positive delay first.',
		'',
		'## 4) What Needs Improvement',
		`- Consistency ratio: ${correctRatio}% (higher is better for stable posture).`,
		'- Main focus remains side bend depth with chest openness and arm-over-ear alignment.',
		'- Maintain knee extension and centered weight over ankles to reduce drift.',
		...(improvements.length
			? improvements.map((item) => `- ${item}`)
			: [
				'- Keep full body visible in frame to reduce skipped analysis windows.',
				'- Lift top arm closer to ear and keep ribcage open during the bend.',
				'- Increase hold stability by slowing entry and exit transitions.',
			]),
		'',
		'## 5) Corrective Drills (Step-by-step)',
		'- Wall-assisted side bend hold: 3 sets x 20-30 sec each side. Keep shoulder, hip, and heel contact where possible.',
		'- Overhead reach drill: 2 sets x 10 reps each side. Reach long first, then bend; avoid shoulder shrugging.',
		'- Static balance drill: 3 sets x 25 sec. Keep pelvis centered over ankles with smooth nasal breathing.',
		'- Mirror form check: 2 rounds x 60 sec. Watch for knee bend and chest collapse; correct immediately.',
		'',
		'## 6) Safety and Breathing Checks',
		'- Do not force range; stop before pain and keep neck relaxed.',
		'- Use inhale to lengthen spine and exhale to deepen bend gradually.',
		'- If dizziness occurs, return to neutral stance and rest.',
		'',
		'## 7) Next Session Target Metrics',
		`- Target average score: >= ${targetScore} / 100.`,
		`- Target consistency ratio: >= ${Math.min(95, Number(correctRatio) + 12).toFixed(0)}%.`,
		`- Target visibility quality: >= ${Math.min(98, 100 - Math.max(5, Number(skippedRatio) - 8)).toFixed(0)}%.`,
		`- Target overall average angle error: <= ${Number.isFinite(Number(overallAngleError)) ? Math.max(5, Number(overallAngleError) - 2).toFixed(2) : '12.00'}°`,
		'',
		'## 8) 7-Day Progressive Practice Plan',
		'- Days 1-2: 3 x 20 sec holds each side, focus only on alignment.',
		'- Days 3-4: 3 x 30 sec holds each side, add smoother transitions.',
		'- Days 5-6: 4 x 30 sec holds each side, aim for lower skipped frames.',
		'- Day 7: Assessment session, compare frame ratios and average score against targets.',
	].join('\n');
}

function buildChatPrompt(question, context) {
	const asanaName = context?.selectedAsana || context?.asanaInfo?.name || 'Unknown Asana';
	const asanaDescription = context?.asanaInfo?.description || 'No asana description available.';
	const asanaFaqs = Array.isArray(context?.asanaInfo?.faqs) ? context.asanaInfo.faqs : [];
	const improvements = Array.isArray(context?.session?.improvements) ? context.session.improvements : [];
	const profile = context?.userProfile || null;
	const session = context?.session || null;
	const historySummary = context?.sessionHistorySummary || {};
	const resultCounts = historySummary?.resultCounts || {};
	const previousSession = historySummary?.previousSession || null;
	const recentFeedback = Array.isArray(historySummary?.recentFeedback) ? historySummary.recentFeedback : [];
	const currentUserFeedback = context?.session?.userFeedback || null;
	const currentTiming = context?.session?.timingAnalysis || null;
	const previousTiming = previousSession?.timingAnalysis || null;
	const currentAngleSummary = context?.session?.angleSummary || null;
	const previousAngleSummary = previousSession?.angleSummary || null;
	const historyAngleComparison = historySummary?.angleComparison || null;
	const currentVsPreviousAngleComparison = context?.angleComparisonCurrentVsPrevious || null;

	const stepKeys = ['step1', 'step2', 'step3'];
	const formatStepAngles = (angleSummary) => {
		if (!angleSummary) {
			return 'not available';
		}
		return stepKeys
			.map((stepKey) => {
				const step = angleSummary?.perStep?.[stepKey] || {};
				const avg = Number.isFinite(Number(step?.averageError)) ? `${Number(step.averageError).toFixed(2)}°` : 'N/A';
				const perf = step?.performance || 'Unknown';
				return `${stepKey}: ${avg} (${perf})`;
			})
			.join(' | ');
	};

	const formatStepDelta = (comparison) => {
		if (!comparison) {
			return 'not available';
		}
		return stepKeys
			.map((stepKey) => {
				const delta = Number(comparison?.perStep?.[stepKey]?.errorDelta);
				return `${stepKey}: ${Number.isFinite(delta) ? `${delta.toFixed(2)}°` : 'N/A'}`;
			})
			.join(' | ');
	};

	const formatJointIssues = (angleSummary) => {
		const issues = Array.isArray(angleSummary?.topJointIssues) ? angleSummary.topJointIssues : [];
		if (!issues.length) {
			return 'not available';
		}
		return issues
			.map((issue) => `${issue.step}:${issue.jointName} (${Number.isFinite(Number(issue?.angleError)) ? Number(issue.angleError).toFixed(2) : 'N/A'}°, ${issue.classification || 'Unknown'})`)
			.join(' | ');
	};

	const formatFeedback = (feedback) => {
		if (!feedback) {
			return 'not available';
		}
		return [
			`overall=${feedback?.overallRating ?? 'N/A'}/5`,
			`coachHelpfulness=${feedback?.coachHelpfulness ?? 'N/A'}/5`,
			`difficulty=${feedback?.difficulty || 'N/A'}`,
			`confidenceBefore=${feedback?.confidenceBeforeSession ?? 'N/A'}/5`,
			`confidence=${feedback?.confidenceAfterSession ?? 'N/A'}/5`,
			`confidenceDelta=${feedback?.confidenceDelta ?? 'N/A'}`,
			`discomfort=${feedback?.discomfortLevel || 'none'}`,
			`painArea=${feedback?.painArea || 'N/A'}`,
			`painIntensity=${feedback?.painIntensity ?? 'N/A'}/10`,
			`hardestStep=${feedback?.hardestStep || 'N/A'}`,
			`correctionFocus=${feedback?.correctionFocus || 'N/A'}`,
			`mainChallenge=${feedback?.mainChallenge || 'N/A'}`,
			`nextSessionGoal=${feedback?.nextSessionGoal || 'N/A'}`,
			`comment=${feedback?.comment || 'none'}`,
		].join(', ');
	};

	const formatRecentFeedback = (items) => {
		if (!items.length) {
			return 'not available';
		}
		return items
			.map((item) => {
				const date = item?.endedAt ? String(item.endedAt).split('T')[0] : 'unknown-date';
				return `${date}: rating=${item?.overallRating ?? 'N/A'}/5, difficulty=${item?.difficulty || 'N/A'}, confidenceBefore=${item?.confidenceBeforeSession ?? 'N/A'}/5, confidence=${item?.confidenceAfterSession ?? 'N/A'}/5, pain=${item?.discomfortLevel || 'none'} (${item?.painArea || 'N/A'}, intensity=${item?.painIntensity ?? 'N/A'}/10), hardestStep=${item?.hardestStep || 'N/A'}, focus=${item?.correctionFocus || 'N/A'}, challenge=${item?.mainChallenge || 'N/A'}, nextGoal=${item?.nextSessionGoal || 'N/A'}, comment=${item?.comment || 'none'}`;
			})
			.join(' | ');
	};

	const formatTimingTriplet = (timing) => {
		if (!timing) {
			return 'not available';
		}
		const toS = (value) => (Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}s` : 'N/A');
		return `step1=${toS(timing?.userStep1Time)}, step2=${toS(timing?.userStep2Time)}, step3=${toS(timing?.userStep3Time)}`;
	};

	const formatIdealTimingTriplet = (timing) => {
		if (!timing) {
			return 'not available';
		}
		const toS = (value) => (Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}s` : 'N/A');
		return `step1=${toS(timing?.idealStep1Time)}, step2=${toS(timing?.idealStep2Time)}, step3=${toS(timing?.idealStep3Time)}`;
	};

	const formatDelayTriplet = (timing) => {
		if (!timing) {
			return 'not available';
		}
		const toS = (value) => (Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}s` : 'N/A');
		return `step1=${toS(timing?.delayStep1)}, step2=${toS(timing?.delayStep2)}, step3=${toS(timing?.delayStep3)}`;
	};

	const formatTimingDeltaTriplet = (current, previous) => {
		if (!current || !previous) {
			return 'not available';
		}
		const delta = (curr, prev) => {
			const c = Number(curr);
			const p = Number(prev);
			if (!Number.isFinite(c) || !Number.isFinite(p)) {
				return 'N/A';
			}
			return `${(c - p).toFixed(2)}s`;
		};
		return `step1=${delta(current?.userStep1Time, previous?.userStep1Time)}, step2=${delta(current?.userStep2Time, previous?.userStep2Time)}, step3=${delta(current?.userStep3Time, previous?.userStep3Time)}`;
	};

	return [
		'You are YogMitra Coach, a concise and practical yoga assistant.',
		'Answer based only on given context. If data is missing, clearly say it is not available.',
		'Do not invent session numbers.',
		'Important: total/correct/moderate/incorrect/skipped values below are frame counts for one session, not number of sessions.',
		'For comparison questions, prioritize numeric angle deltas over generic advice.',
		'Keep response short, clear, and actionable for a learner.',
		'',
		'Context:',
		`- Selected asana: ${asanaName}`,
		`- Asana description: ${asanaDescription}`,
		`- Asana FAQs: ${asanaFaqs.join(' | ') || 'none'}`,
		`- User profile: age=${profile?.age ?? 'unknown'}, flexibility=${profile?.flexibility ?? 'unknown'}, experience=${profile?.experience ?? 'unknown'}`,
		`- Completed sessions for this asana: ${historySummary?.totalSessions ?? 0}`,
		`- Historical results distribution: Correct=${resultCounts?.Correct ?? 0}, Moderate=${resultCounts?.Moderate ?? 0}, Incorrect=${resultCounts?.Incorrect ?? 0}`,
		`- Session result: ${session?.finalResult ?? 'no completed session yet'}`,
		`- Session average score: ${Number.isFinite(session?.averageScore) ? Number(session.averageScore).toFixed(2) : 'unknown'}`,
		`- Session duration: ${session?.sessionDuration ?? 'unknown'}`,
		`- Current session frame counts: total=${session?.totalFrames ?? 'unknown'}, correct=${session?.correctFrameCount ?? 'unknown'}, moderate=${session?.moderateFrameCount ?? 'unknown'}, incorrect=${session?.incorrectFrameCount ?? 'unknown'}, skipped=${session?.skippedFrameCount ?? 'unknown'}`,
		`- Current session user timestamps: ${formatTimingTriplet(currentTiming)}`,
		`- Current session ideal timestamps: ${formatIdealTimingTriplet(currentTiming)}`,
		`- Current session timing delays vs ideal: ${formatDelayTriplet(currentTiming)}`,
		`- Current session user feedback: ${formatFeedback(currentUserFeedback)}`,
		`- Recent user feedback history (latest up to 5): ${formatRecentFeedback(recentFeedback)}`,
		`- Current session angle vs ideal (average error): overall=${Number.isFinite(Number(currentAngleSummary?.overallAverageError)) ? Number(currentAngleSummary.overallAverageError).toFixed(2) : 'N/A'}°, performance=${currentAngleSummary?.overallPerformance || 'Unknown'}`,
		`- Current session per-step angle summary: ${formatStepAngles(currentAngleSummary)}`,
		`- Current session top joint issues: ${formatJointIssues(currentAngleSummary)}`,
		`- Previous completed session: result=${previousSession?.finalResult ?? 'not available'}, score=${Number.isFinite(previousSession?.averageScore) ? Number(previousSession.averageScore).toFixed(2) : 'not available'}, duration=${previousSession?.sessionDuration ?? 'not available'}`,
		`- Previous session frame counts: total=${previousSession?.totalFrames ?? 'not available'}, correct=${previousSession?.correctFrameCount ?? 'not available'}, moderate=${previousSession?.moderateFrameCount ?? 'not available'}, incorrect=${previousSession?.incorrectFrameCount ?? 'not available'}, skipped=${previousSession?.skippedFrameCount ?? 'not available'}`,
		`- Previous session user timestamps: ${formatTimingTriplet(previousTiming)}`,
		`- Previous session ideal timestamps: ${formatIdealTimingTriplet(previousTiming)}`,
		`- Previous session timing delays vs ideal: ${formatDelayTriplet(previousTiming)}`,
		`- Timing delta (current vs previous): ${formatTimingDeltaTriplet(currentTiming, previousTiming)}`,
		`- Previous session angle vs ideal (average error): overall=${Number.isFinite(Number(previousAngleSummary?.overallAverageError)) ? Number(previousAngleSummary.overallAverageError).toFixed(2) : 'N/A'}°, performance=${previousAngleSummary?.overallPerformance || 'Unknown'}`,
		`- Previous session per-step angle summary: ${formatStepAngles(previousAngleSummary)}`,
		`- Angle delta (latest completed vs previous completed): overall=${Number.isFinite(Number(historyAngleComparison?.overallErrorDelta)) ? Number(historyAngleComparison.overallErrorDelta).toFixed(2) : 'N/A'}°, by step -> ${formatStepDelta(historyAngleComparison)}`,
		`- Angle delta (current context vs previous completed): overall=${Number.isFinite(Number(currentVsPreviousAngleComparison?.overallErrorDelta)) ? Number(currentVsPreviousAngleComparison.overallErrorDelta).toFixed(2) : 'N/A'}°, by step -> ${formatStepDelta(currentVsPreviousAngleComparison)}`,
		`- Improvements from system: ${improvements.join(' | ') || 'none'}`,
		'',
		`User question: ${question}`,
	].join('\n');
}

function fallbackChatReply(question, context) {
	const asanaName = context?.selectedAsana || 'this asana';
	const session = context?.session || null;
	const hasSession = Boolean(session && Number.isFinite(session?.averageScore));
	const base = [
		`I can help with ${asanaName}, but OpenRouter is not available right now.`,
		'Here is a quick guidance based on available local data:',
	];

	if (hasSession) {
		base.push(`- Your last session result was ${session.finalResult || 'Unknown'} with average score ${Number(session.averageScore).toFixed(2)}/10.`);
	}

	const improvements = Array.isArray(session?.improvements) ? session.improvements : [];
	if (improvements.length) {
		base.push(`- Priority fix: ${improvements[0]}`);
	}

	base.push(`- Your question was: "${question}"`);
	base.push('- Retry once OpenRouter key/quota is available for a detailed personalized answer.');
	return base.join('\n');
}

app.post('/api/report', async (req, res) => {
	try {
		const payload = req.body?.data;
		if (!payload) {
			res.status(400).send('Missing report payload.');
			return;
		}

		if (!OPENROUTER_API_KEY) {
			res.json({
				report: `${fallbackReport(payload)}\n\nOpenRouter is not configured on server. Set OPENROUTER_API_KEY and restart server.`,
			});
			return;
		}

		let lastErrorStatus = 0;
		let lastErrorDetails = 'Unknown OpenRouter API error.';
		const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENROUTER_API_KEY}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': process.env.OPENROUTER_SITE_URL || `http://localhost:${PORT}`,
				'X-Title': process.env.OPENROUTER_APP_NAME || 'YogMitra',
			},
			body: JSON.stringify({
				model: OPENROUTER_MODEL,
				messages: [
					{ role: 'user', content: buildPrompt(payload) },
				],
				temperature: 0.2,
				top_p: 0.9,
				max_tokens: 1400,
			}),
		});

		if (response.ok) {
			const result = await response.json();
			const content = result?.choices?.[0]?.message?.content;
			const text = Array.isArray(content)
				? content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('\n').trim()
				: String(content || '').trim();
			if (text) {
				res.json({ report: text, source: 'openrouter', model: OPENROUTER_MODEL });
				return;
			}
			lastErrorStatus = 502;
			lastErrorDetails = `OpenRouter returned empty response for model ${OPENROUTER_MODEL}.`;
		} else {
			lastErrorStatus = response.status;
			lastErrorDetails = await response.text();
		}

		const quotaLikely = lastErrorStatus === 429 || /quota|resource_exhausted|rate/i.test(lastErrorDetails);
		const fallbackNote = quotaLikely
			? 'OpenRouter quota/rate limit reached. Showing detailed local coaching report instead.'
			: 'OpenRouter is temporarily unavailable. Showing detailed local coaching report instead.';

		res.json({
			report: `${fallbackReport(payload)}\n\n${fallbackNote}`,
			source: 'fallback',
			reason: quotaLikely ? 'quota_exceeded' : 'openrouter_unavailable',
		});
	} catch (error) {
		res.json({
			report: `${fallbackReport(req.body?.data || {})}\n\nServer error while contacting OpenRouter: ${error.message}\nShowing detailed local coaching report instead.`,
			source: 'fallback',
			reason: 'server_error',
		});
	}
});

app.post('/api/chat', async (req, res) => {
	try {
		const question = String(req.body?.question || '').trim();
		const context = req.body?.context || {};
		if (!question) {
			res.status(400).send('Missing chat question.');
			return;
		}

		if (!OPENROUTER_API_KEY) {
			res.json({
				reply: `${fallbackChatReply(question, context)}\n\nOpenRouter is not configured. Set OPENROUTER_API_KEY in server environment and restart.`,
				source: 'fallback',
				reason: 'missing_api_key',
			});
			return;
		}

		const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENROUTER_API_KEY}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': process.env.OPENROUTER_SITE_URL || `http://localhost:${PORT}`,
				'X-Title': process.env.OPENROUTER_APP_NAME || 'YogMitra',
			},
			body: JSON.stringify({
				model: OPENROUTER_MODEL,
				messages: [
					{ role: 'user', content: buildChatPrompt(question, context) },
				],
				temperature: 0.2,
				top_p: 0.9,
				max_tokens: 500,
			}),
		});

		if (response.ok) {
			const result = await response.json();
			const content = result?.choices?.[0]?.message?.content;
			const text = Array.isArray(content)
				? content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('\n').trim()
				: String(content || '').trim();

			if (text) {
				res.json({ reply: text, source: 'openrouter', model: OPENROUTER_MODEL });
				return;
			}
		}

		const errorText = response.ok ? 'Empty response from OpenRouter.' : await response.text();
		res.json({
			reply: `${fallbackChatReply(question, context)}\n\nOpenRouter temporary issue: ${errorText}`,
			source: 'fallback',
			reason: 'openrouter_unavailable',
		});
	} catch (error) {
		res.json({
			reply: `${fallbackChatReply(String(req.body?.question || ''), req.body?.context || {})}\n\nServer error: ${error.message}`,
			source: 'fallback',
			reason: 'server_error',
		});
	}
});

app.use((_req, res) => {
	res.sendFile(path.join(HAS_DIST_BUILD ? DIST_DIR : __dirname, 'index.html'));
});

app.listen(PORT, () => {
	console.log(`YogMitra server running at http://localhost:${PORT}`);
});

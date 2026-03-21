const LEFT_SHOULDER = 5;
const RIGHT_SHOULDER = 6;
const LEFT_ELBOW = 7;
const RIGHT_ELBOW = 8;
const LEFT_WRIST = 9;
const RIGHT_WRIST = 10;
const LEFT_HIP = 11;
const RIGHT_HIP = 12;
const LEFT_KNEE = 13;
const RIGHT_KNEE = 14;
const LEFT_ANKLE = 15;
const RIGHT_ANKLE = 16;

function angle(a, b, c) {
	if (!a || !b || !c) return 180;
	const abx = a.x - b.x;
	const aby = a.y - b.y;
	const cbx = c.x - b.x;
	const cby = c.y - b.y;
	const dot = abx * cbx + aby * cby;
	const magAB = Math.hypot(abx, aby);
	const magCB = Math.hypot(cbx, cby);
	if (magAB === 0 || magCB === 0) return 180;
	const cos = Math.min(1, Math.max(-1, dot / (magAB * magCB)));
	return (Math.acos(cos) * 180) / Math.PI;
}

export function generateFeedback({ pose, prediction }) {
	if (!pose || !pose.keypoints) {
		return {
			score: 0,
			messages: ['No full body detected. Step back so your entire posture is visible.'],
		};
	}

	const kp = pose.keypoints;
	const messages = [];
	let score = prediction.label === 'correct' ? 8.5 : prediction.label === 'moderate' ? 6 : 3.5;

	const leftKneeAngle = angle(kp[LEFT_HIP], kp[LEFT_KNEE], kp[LEFT_ANKLE]);
	const rightKneeAngle = angle(kp[RIGHT_HIP], kp[RIGHT_KNEE], kp[RIGHT_ANKLE]);
	if (leftKneeAngle < 165 || rightKneeAngle < 165) {
		messages.push('Keep your legs straight.');
		score -= 1.2;
	}

	const leftArmY = kp[LEFT_WRIST]?.y ?? kp[LEFT_ELBOW]?.y ?? 9999;
	const rightArmY = kp[RIGHT_WRIST]?.y ?? kp[RIGHT_ELBOW]?.y ?? 9999;
	const shoulderY = Math.min(kp[LEFT_SHOULDER]?.y ?? 9999, kp[RIGHT_SHOULDER]?.y ?? 9999);
	if (Math.min(leftArmY, rightArmY) > shoulderY + 10) {
		messages.push('Raise your arm closer to your ear.');
		score -= 1.0;
	}

	const shoulderCenterX = ((kp[LEFT_SHOULDER]?.x ?? 0) + (kp[RIGHT_SHOULDER]?.x ?? 0)) / 2;
	const hipCenterX = ((kp[LEFT_HIP]?.x ?? 0) + (kp[RIGHT_HIP]?.x ?? 0)) / 2;
	if (Math.abs(shoulderCenterX - hipCenterX) < 18) {
		messages.push('Bend sideways a little more from the waist.');
		score -= 1.1;
	}

	const shoulderWidth = Math.abs((kp[LEFT_SHOULDER]?.x ?? 0) - (kp[RIGHT_SHOULDER]?.x ?? 0));
	const hipWidth = Math.abs((kp[LEFT_HIP]?.x ?? 0) - (kp[RIGHT_HIP]?.x ?? 0));
	if (shoulderWidth < 26 || hipWidth < 22) {
		messages.push('Keep your chest facing forward.');
		score -= 0.8;
	}

	const ankleMid = ((kp[LEFT_ANKLE]?.x ?? 0) + (kp[RIGHT_ANKLE]?.x ?? 0)) / 2;
	if (Math.abs(hipCenterX - ankleMid) > 28) {
		messages.push('Maintain balance and keep your weight centered.');
		score -= 0.7;
	}

	if (messages.length === 0) {
		messages.push('Great alignment. Hold steadily and breathe evenly.');
		score += 0.8;
	}

	score = Math.max(0, Math.min(10, score));
	return { score, messages };
}

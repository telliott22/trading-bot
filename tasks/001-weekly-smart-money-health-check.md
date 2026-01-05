---
created: 2026-01-05
scheduled_task_id: null
related: [agent/src/smart-money/README.md]
---

# Weekly Smart Money Detector Health Check

## Objective
Verify the smart money detector is running correctly and catching insider trading signals on Polymarket.

## Steps

1. **Check Render service status**
   - Go to Render dashboard or check health endpoint
   - `curl https://smart-money-detector.onrender.com/health`
   - Verify uptime, markets monitored, trades processed

2. **Check stats endpoint**
   - `curl https://smart-money-detector.onrender.com/stats`
   - Verify alerts are being generated (last24h, last7d should have values)
   - Check that markets are being monitored

3. **Check dashboard**
   - Visit the dashboard and click "Smart Money" tab
   - Verify alerts are showing
   - Check that the data is recent (lastUpdated timestamp)

4. **Check Telegram alerts**
   - Confirm alerts have been received in Telegram this week
   - If no alerts, that could be fine (no suspicious activity) or a problem

5. **Check Render logs if issues**
   - Look for WebSocket connection errors
   - Look for market refresh issues
   - Check for any crashes/restarts

## Context
The smart money detector monitors Polymarket for insider trading signals using percentile-based detection. It should be running 24/7 on Render as a worker service.

## Acceptance Criteria
- [ ] Health endpoint returns status: ok
- [ ] Stats show markets > 0 and trades > 0
- [ ] Dashboard Smart Money tab loads and shows data
- [ ] No error patterns in Render logs

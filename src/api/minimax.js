const axios = require('axios');
const https = require('https');

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  maxFreeSockets: 2,
  timeout: 10000
});

class MinimaxAPI {
  constructor(token, groupId = null) {
    this.token = token;
    this.groupId = groupId;
    this.cache = { data: null, timestamp: 0 };
    this.cacheTimeout = 8000;
  }

  async getUsageStatus(forceRefresh = false) {
    if (!this.token) {
      throw new Error('Missing credentials. Please add an account first.');
    }

    const now = Date.now();
    if (!forceRefresh && this.cache.data && now - this.cache.timestamp < this.cacheTimeout) {
      return this.cache.data;
    }

    try {
      const response = await axios.get(
        'https://www.minimax.io/v1/token_plan/remains',
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json'
          },
          timeout: 10000,
          httpsAgent
        }
      );

      // Validate API envelope. base_resp.status_code === 0 means success;
      // anything else is an API-level error and we should not try to parse it.
      const baseResp = response.data?.base_resp;
      if (baseResp && baseResp.status_code !== 0) {
        throw new Error(
          `MiniMax API error (${baseResp.status_code}): ${baseResp.status_msg || 'unknown error'}`
        );
      }

      this.cache.data = response.data;
      this.cache.timestamp = now;
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Invalid token or unauthorized.');
      }
      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout.');
      }
      // Pass our own clean errors through without re-wrapping.
      if (error.message?.startsWith('MiniMax API error')) {
        throw error;
      }
      throw new Error(`API request failed: ${error.message}`);
    }
  }

  parseUsageData(apiData, lang = 'zh-CN') {
    if (!apiData.model_remains || apiData.model_remains.length === 0) {
      throw new Error('No usage data available');
    }

    const modelData = apiData.model_remains[0];
    const startTime = new Date(modelData.start_time);
    const endTime = new Date(modelData.end_time);
    const now = Date.now();

    const totalCount = modelData.current_interval_total_count || 0;
    const usedCount = modelData.current_interval_usage_count || 0;
    const remainingCount = totalCount - usedCount;
    // Prefer server-computed remaining %; fall back to count-based math for older responses.
    const usedPercentage = modelData.current_interval_remaining_percent != null
      ? Math.max(0, Math.min(100, 100 - Number(modelData.current_interval_remaining_percent)))
      : (totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0);

    // Prefer server-provided remains_time; fall back to end_time - now.
    const remainingMs = modelData.remains_time != null
      ? Math.max(0, Number(modelData.remains_time))
      : Math.max(0, endTime.getTime() - now);
    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    const weeklyTotal = modelData.current_weekly_total_count || apiData.current_weekly_total_count || 0;
    const weeklyUsed = modelData.current_weekly_usage_count || apiData.current_weekly_usage_count || 0;
    const weeklyRemaining = weeklyTotal - weeklyUsed;
    const weeklyPercentage = modelData.current_weekly_remaining_percent != null
      ? Math.max(0, Math.min(100, 100 - Number(modelData.current_weekly_remaining_percent)))
      : (weeklyTotal > 0 ? Math.round((weeklyUsed / weeklyTotal) * 100) : 0);

    const weeklyEndMs = modelData.weekly_end_time
      ? new Date(modelData.weekly_end_time).getTime()
      : 0;
    const weeklyRemainingMs = modelData.weekly_remains_time != null
      ? Math.max(0, Number(modelData.weekly_remains_time))
      : (weeklyEndMs ? Math.max(0, weeklyEndMs - now) : 0);
    const weeklyDays = Math.floor(weeklyRemainingMs / (1000 * 60 * 60 * 24));
    const weeklyHours = Math.floor((weeklyRemainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    const i18nText = {
      'zh-CN': {
        reset: (h, m) => h > 0 ? `${h} 小时 ${m} 分钟后重置` : `${m} 分钟后重置`,
        weeklyReset: (d, h) => d > 0 ? `${d} 天 ${h} 小时后重置` : `${h} 小时后重置`
      },
      'zh-TW': {
        reset: (h, m) => h > 0 ? `${h} 小時 ${m} 分鐘後重置` : `${m} 分鐘後重置`,
        weeklyReset: (d, h) => d > 0 ? `${d} 天 ${h} 小時後重置` : `${h} 小時後重置`
      },
      'en': {
        reset: (h, m) => h > 0 ? `Reset in ${h}h ${m}m` : `Reset in ${m}m`,
        weeklyReset: (d, h) => d > 0 ? `Reset in ${d}d ${h}h` : `Reset in ${h}h`
      }
    };

    const txt = i18nText[lang] || i18nText['en'];

    return {
      modelName: modelData.model_name,
      intervalStatus: modelData.current_interval_status ?? null,
      weeklyStatus: modelData.current_weekly_status ?? null,
      timeWindow: {
        start: startTime.toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai', hour12: false }),
        end: endTime.toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai', hour12: false }),
        timezone: 'UTC+8'
      },
      remaining: { hours, minutes, text: txt.reset(hours, minutes), ms: remainingMs },
      usage: {
        used: usedCount,
        remaining: remainingCount,
        total: totalCount,
        percentage: usedPercentage,
        hasCounts: totalCount > 0
      },
      weekly: {
        used: weeklyUsed,
        remaining: weeklyRemaining,
        total: weeklyTotal,
        percentage: weeklyPercentage,
        days: weeklyDays,
        hours: weeklyHours,
        // Truly unlimited only if we have neither a count total nor a server-tracked percent.
        // total === 0 alone means "uncapped but tracked" — the percent is still meaningful.
        unlimited: weeklyTotal === 0 && modelData.current_weekly_remaining_percent == null,
        hasCounts: weeklyTotal > 0,
        text: txt.weeklyReset(weeklyDays, weeklyHours),
        ms: weeklyRemainingMs,
        startTime: modelData.weekly_start_time ?? null
      }
    };
  }

  parseAllModels(apiData) {
    if (!apiData.model_remains || apiData.model_remains.length === 0) {
      return [];
    }

    const now = Date.now();
    return apiData.model_remains.map(modelData => {
      const totalCount = modelData.current_interval_total_count || 0;
      const usedCount = modelData.current_interval_usage_count || 0;
      const remainingCount = totalCount - usedCount;
      const usedPercentage = modelData.current_interval_remaining_percent != null
        ? Math.max(0, Math.min(100, 100 - Number(modelData.current_interval_remaining_percent)))
        : (totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0);

      const weeklyTotal = modelData.current_weekly_total_count || 0;
      const weeklyUsed = modelData.current_weekly_usage_count || 0;
      const weeklyRemaining = weeklyTotal - weeklyUsed;
      const weeklyPercentage = modelData.current_weekly_remaining_percent != null
        ? Math.max(0, Math.min(100, 100 - Number(modelData.current_weekly_remaining_percent)))
        : (weeklyTotal > 0 ? Math.round((weeklyUsed / weeklyTotal) * 100) : 0);

      const weeklyEndMs = modelData.weekly_end_time
        ? new Date(modelData.weekly_end_time).getTime()
        : 0;
      const weeklyRemainingMs = modelData.weekly_remains_time != null
        ? Math.max(0, Number(modelData.weekly_remains_time))
        : (weeklyEndMs ? Math.max(0, weeklyEndMs - now) : 0);

      return {
        name: modelData.model_name,
        intervalStatus: modelData.current_interval_status ?? null,
        weeklyStatus: modelData.current_weekly_status ?? null,
        used: usedCount,
        remaining: remainingCount,
        total: totalCount,
        percentage: usedPercentage,
        hasCounts: totalCount > 0,
        weeklyPercentage,
        weeklyTotal,
        weeklyUsed,
        weeklyRemaining,
        weeklyRemainingMs,
        weeklyHasCounts: weeklyTotal > 0,
        weeklyUnlimited: weeklyTotal === 0 && modelData.current_weekly_remaining_percent == null
      };
    });
  }
}

module.exports = MinimaxAPI;
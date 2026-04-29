const axios = require('axios');
const https = require('https');

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  maxFreeSockets: 2,
  timeout: 10000,
  servername: 'minimax.io'
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
      throw new Error(`API request failed: ${error.message}`);
    }
  }

  async getSubscriptionDetails() {
    try {
      const response = await axios.get(
        'https://www.minimaxi.com/v1/api/openplatform/charge/combo/cycle_audio_resource_package',
        {
          params: {
            biz_line: 2,
            cycle_type: 1,
            resource_package_type: 7
          },
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json'
          },
          timeout: 10000,
          httpsAgent
        }
      );
      return response.data;
    } catch {
      return null;
    }
  }

  parseUsageData(apiData, subscriptionData, lang = 'zh-CN') {
    if (!apiData.model_remains || apiData.model_remains.length === 0) {
      throw new Error('No usage data available');
    }

    const modelData = apiData.model_remains[0];
    const startTime = new Date(modelData.start_time);
    const endTime = new Date(modelData.end_time);

    const totalCount = modelData.current_interval_total_count || 0;
    const usedCount = modelData.current_interval_usage_count || 0;
    const remainingCount = totalCount - usedCount;
    const usedPercentage = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;

    // Calculate remaining time until reset using endTime
    const now = Date.now();
    const remainingMs = Math.max(0, endTime.getTime() - now);
    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    // Weekly data - check top level of apiData (not inside model_remains[0])
    const weeklyTotal = modelData.current_weekly_total_count || apiData.current_weekly_total_count || 0;
    const weeklyUsed = modelData.current_weekly_usage_count || apiData.current_weekly_usage_count || 0;
    const weeklyRemaining = weeklyTotal - weeklyUsed;
    const weeklyPercentage = weeklyTotal > 0 ? Math.round((weeklyUsed / weeklyTotal) * 100) : 0;
    // Weekly remaining time: try weekly_remains_time, then calculate from weekly_end_time
    const weeklyEndTime = apiData.weekly_end_time || modelData.weekly_end_time;
    const weeklyRemainsTime = apiData.weekly_remains_time || modelData.weekly_remains_time || 0;
    let weeklyRemainingMs = weeklyRemainsTime;
    if (!weeklyRemainingMs && weeklyEndTime) {
      const weeklyEndMs = typeof weeklyEndTime === 'number' ? weeklyEndTime : parseInt(weeklyEndTime, 10);
      weeklyRemainingMs = Math.max(0, weeklyEndMs - now);
    }
    const weeklyDays = Math.floor(weeklyRemainingMs / (1000 * 60 * 60 * 24));
    const weeklyHours = Math.floor((weeklyRemainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    const i18nText = {
      'zh-CN': {
        reset: (h, m) => h > 0 ? `${h} 小时 ${m} 分钟后重置` : `${m} 分钟后重置`,
        weeklyReset: (d, h) => d > 0 ? `${d} 天 ${h} 小时后重置` : `${h} 小时后重置`,
        expiryRemaining: (d) => `还剩 ${d} 天`,
        expiryToday: '今天到期',
        expiryExpired: (d) => `已过期 ${d} 天`
      },
      'zh-TW': {
        reset: (h, m) => h > 0 ? `${h} 小時 ${m} 分鐘後重置` : `${m} 分鐘後重置`,
        weeklyReset: (d, h) => d > 0 ? `${d} 天 ${h} 小時後重置` : `${h} 小時後重置`,
        expiryRemaining: (d) => `還剩 ${d} 天`,
        expiryToday: '今天到期',
        expiryExpired: (d) => `已過期 ${d} 天`
      },
      'en': {
        reset: (h, m) => h > 0 ? `Reset in ${h}h ${m}m` : `Reset in ${m}m`,
        weeklyReset: (d, h) => d > 0 ? `Reset in ${d}d ${h}h` : `Reset in ${h}h`,
        expiryRemaining: (d) => `${d} days remaining`,
        expiryToday: 'Expires today',
        expiryExpired: (d) => `Expired ${d} days ago`
      }
    };

    const txt = i18nText[lang] || i18nText['en'];

    let expiryInfo = null;
    if (subscriptionData?.current_subscribe?.current_subscribe_end_time) {
      const expiryDate = subscriptionData.current_subscribe.current_subscribe_end_time;
      const expiry = new Date(expiryDate);
      const now = new Date();
      const timeDiff = expiry.getTime() - now.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

      expiryInfo = {
        date: expiryDate,
        daysRemaining: daysDiff,
        text: daysDiff > 0 ? txt.expiryRemaining(daysDiff) : daysDiff === 0 ? txt.expiryToday : txt.expiryExpired(Math.abs(daysDiff))
      };
    }

    return {
      modelName: modelData.model_name,
      timeWindow: {
        start: startTime.toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai', hour12: false }),
        end: endTime.toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai', hour12: false }),
        timezone: 'UTC+8'
      },
      remaining: { hours, minutes, text: txt.reset(hours, minutes), ms: remainingMs },
      usage: { used: usedCount, remaining: remainingCount, total: totalCount, percentage: usedPercentage },
      weekly: {
        used: weeklyUsed,
        remaining: weeklyRemaining,
        total: weeklyTotal,
        percentage: weeklyPercentage,
        days: weeklyDays,
        hours: weeklyHours,
        unlimited: weeklyTotal === 0,
        text: txt.weeklyReset(weeklyDays, weeklyHours),
        ms: weeklyRemainingMs
      },
      expiry: expiryInfo
    };
  }

  parseAllModels(apiData) {
    if (!apiData.model_remains || apiData.model_remains.length === 0) {
      return [];
    }

    return apiData.model_remains.map(modelData => {
      const totalCount = modelData.current_interval_total_count || 0;
      const usedCount = modelData.current_interval_usage_count || 0;
      const remainingCount = totalCount - usedCount;
      const usedPercentage = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;

      const weeklyTotal = modelData.current_weekly_total_count || 0;
      const weeklyUsed = modelData.current_weekly_usage_count || 0;
      const weeklyRemaining = weeklyTotal - weeklyUsed;
    const weeklyPercentage = weeklyTotal > 0 ? Math.round((weeklyUsed / weeklyTotal) * 100) : 0;

      return {
        name: modelData.model_name,
        used: usedCount,
        remaining: remainingCount,
        total: totalCount,
        percentage: usedPercentage,
        unlimited: weeklyTotal === 0,
        weeklyPercentage,
        weeklyTotal,
        weeklyUsed,
        weeklyRemaining
      };
    });
  }
}

module.exports = MinimaxAPI;
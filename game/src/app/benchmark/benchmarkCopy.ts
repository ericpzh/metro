import type { Language } from '../../sim/i18n.ts'

export const BENCHMARK_COPY = {
  en: {
    eyebrow: 'STATION DESIGNER · PERFORMANCE', title: 'Browser benchmark',
    intro: 'Measure the first 30 seconds of simulation playback in this browser. The game runs at 16× speed.',
    station: 'Demo station', zoo: 'Zoo', tanwei: 'Tanwei', graphics: 'Graphics detail', low: 'Low LOD', high: 'High LOD',
    view: 'View', normal: 'Normal', explode: 'Exploded', start: 'Start 30 second benchmark',
    keepVisible: 'One station and one view are measured per run. Keep this tab visible until the result appears.',
    preparing: 'Preparing benchmark', loading: 'Loading the selected station and renderer…', booting: 'Starting the game renderer…', loadingStation: 'Loading the selected station…', preparingScene: 'Preparing the benchmark scene…', settling: 'Letting the scene settle…', running: 'Benchmark running', controlsLocked: 'controls locked',
    seconds: 's remaining', couldNotFinish: 'Benchmark could not finish', back: 'Back to setup', again: 'Run another benchmark',
    first30: 'FIRST 30 SECONDS OF SIM PLAY', average: 'Average FPS', low1: '1% low FPS', worst: 'Worst submitted frame',
    hardware: 'Hardware and run data', browser: 'Browser', gpu: 'GPU', cores: 'Logical CPU cores', memory: 'Device memory',
    viewport: 'Renderer viewport', geometry: 'Station geometry', run: 'Run', samples: 'Samples',
    unavailable: 'Not reported by browser', fpsChart: 'Frames per second over the first thirty seconds of simulation play',
    capped: 'FPS is capped at 60 on this chart', secondsWall: 'Seconds since simulation started (wall clock)',
    chartNote: 'Train arrival labels mark increases in the worker arrival count. FPS above 60 is shown at the chart ceiling.',
    intervalInfo: 'FPS uses submitted-frame intervals from this run. The 1% low is the inverse of the mean interval among the slowest 1% of samples. Browser hardware details are limited to values the browser exposes.',
    intervals: 'submitted-frame intervals', arrivals: 'train arrivals', language: '中文', tick: 'tick', secShort: 's',
    dpr: 'at DPR', cells: 'cells', modules: 'modules', level: 'active level', zoom: '50% closer',
    setupError: 'The simulation did not become ready.', explodedError: 'The exploded view did not finish opening.',
    stationError: 'The station renderer did not finish loading.', rendererError: 'The benchmark renderer is unavailable.', noFramesError: 'No submitted frames were recorded.',
  },
  zh: {
    eyebrow: '车站设计师 · 性能测试', title: '浏览器性能测试',
    intro: '测量此浏览器中模拟运行开始后的前 30 秒。游戏以 16× 速度运行。',
    station: '示范车站', zoo: '动物园站', tanwei: '坦尾站', graphics: '画面细节', low: '低画质', high: '高画质',
    view: '视图', normal: '普通视图', explode: '爆炸视图', start: '开始 30 秒测试',
    keepVisible: '每次运行测量一个车站和一种视图。请保持此标签页在前台，直到结果显示。',
    preparing: '正在准备测试', loading: '正在载入所选车站和渲染场景…', booting: '正在启动游戏渲染器…', loadingStation: '正在载入所选车站…', preparingScene: '正在准备测试场景…', settling: '正在等待场景稳定…', running: '正在运行测试', controlsLocked: '操作已锁定',
    seconds: '秒后结束', couldNotFinish: '测试未能完成', back: '返回设置', again: '再测一次',
    first30: '模拟运行开始后的前 30 秒', average: '平均 FPS', low1: '1% 低帧率', worst: '最慢提交帧',
    hardware: '硬件与测试数据', browser: '浏览器', gpu: '显卡', cores: '逻辑 CPU 核心', memory: '设备内存',
    viewport: '渲染视口', geometry: '车站规模', run: '测试设置', samples: '样本数',
    unavailable: '浏览器未提供', fpsChart: '模拟运行开始后前 30 秒的每秒帧数',
    capped: '图表最高显示 60 FPS', secondsWall: '模拟开始后的秒数（墙上时钟）',
    chartNote: '标记表示工作线程中的列车到站计数增加。超过 60 的 FPS 显示在图表上限。',
    intervalInfo: 'FPS 根据本次运行的已提交帧间隔计算。1% 低帧率为最慢 1% 样本的平均帧间隔倒数。浏览器只会提供有限的硬件信息。',
    intervals: '个提交帧间隔', arrivals: '次列车到站', language: 'English', tick: '时刻', secShort: '秒',
    dpr: '设备像素比', cells: '个方块', modules: '个设备', level: '当前楼层', zoom: '放大 50%',
    setupError: '模拟器未能就绪。', explodedError: '爆炸视图未能完成载入。',
    stationError: '车站渲染器未能完成载入。', rendererError: '无法使用基准测试渲染器。', noFramesError: '没有记录到已提交的帧。',
  },
} satisfies Record<'en' | 'zh', Record<string, string>>

export function benchmarkCopy(language: Language) {
  return BENCHMARK_COPY[language === 'en' ? 'en' : 'zh']
}

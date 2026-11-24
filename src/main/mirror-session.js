const { MessageChannelMain } = require('electron');

class MirrorSession {
  constructor(driver) {
    this.driver = driver;
    this.active = null;
    this.pending = Promise.resolve();
  }

  enqueue(work) {
    const result = this.pending.then(work);
    this.pending = result.catch(() => {});
    return result;
  }

  release(session) {
    if (this.active !== session) return;
    this.active = null;
    try { session.port1.postMessage({ type: 'exited' }); }
    finally { session.port1.close(); }
  }

  start(sender, { deviceId, options }) {
    return this.enqueue(async () => {
      if (this.active) return { success: false, error: '请先停止当前投屏' };
      if (sender.isDestroyed()) return { success: false, error: '窗口已关闭' };
      const session = new MessageChannelMain();
      this.active = session;
      const send = message => {
        if (this.active === session) session.port1.postMessage(message);
      };
      try {
        session.port1.on('message', ({ data }) => {
          if (this.active !== session) return;
          const methods = { touch: ['injectTouch', data.touch], keycode: ['injectKeyCode', data.keyName], scroll: ['injectScroll', data.scroll] };
          const method = methods[data.type];
          if (Array.isArray(method)) this.driver[method[0]](method[1]).catch(console.warn);
        });
        session.port1.start();
        sender.postMessage('scrcpy-stream-port', null, [session.port2]);
        await this.driver.startSession({
          deviceId, options,
          onSizeChanged: size => send({ type: 'size-changed', size }),
          onPacket: packet => send({ type: 'packet', packetType: packet.type, keyframe: packet.keyframe, buffer: packet.data }),
          onExited: () => this.release(session)
        });
        return { success: this.active === session };
      } catch (error) {
        try { await this.driver.stopSession(); } finally { this.release(session); }
        return { success: false, error: error.message };
      }
    });
  }

  stop() {
    return this.enqueue(async () => {
      const session = this.active;
      if (session) {
        try { await this.driver.stopSession(); } finally { this.release(session); }
      }
      return { success: true };
    });
  }
}

module.exports = MirrorSession;

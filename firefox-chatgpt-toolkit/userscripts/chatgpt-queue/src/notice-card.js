/* SPDX-License-Identifier: GPL-3.0-or-later */
// Standalone DOM component. Styling comes from notice-card / pill / accent CSS.
class NoticeCard {
  constructor({ message = '', actions = [] } = {}) {
    this.element = document.createElement('div'); this.element.className = 'notice-card';
    this.element.setAttribute('role', 'alert');
    this.message = document.createElement('p'); this.message.textContent = message;
    const controls = document.createElement('div'); controls.className = 'actions';
    this.buttons = actions.map(({ label, action, accent = false }) => {
      const control = document.createElement('button'); control.type = 'button';
      control.className = accent ? 'pill accent' : 'pill'; control.textContent = label;
      control.addEventListener('click', action); controls.append(control); return control;
    });
    this.element.append(this.message, controls);
  }
  setMessage(message) { this.message.textContent = message; }
}

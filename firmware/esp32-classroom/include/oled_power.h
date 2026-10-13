#pragma once

#include <stdint.h>

enum class OledState { IDLE, WAITING, EXAM, FINISHED };

// OLED-only timers: never pause the CPU, network, quiz clock or pending answers.
class OledPower {
 public:
  bool sleeping() const { return sleeping_; }
  bool dirty() const { return dirty_; }
  void invalidate() { dirty_ = true; }
  void rendered() { dirty_ = false; }

  void wake(uint32_t now) {
    lastActivityAt_ = now;
    if (sleeping_) {
      sleeping_ = false;
      invalidate();
    }
  }

  void update(OledState nextState, uint32_t now) {
    if (nextState != state_) {
      state_ = nextState;
      wake(now);
      invalidate();
    }
    if (state_ == OledState::EXAM) {
      if (sleeping_) wake(now);
      return;
    }
    const uint32_t timeout = state_ == OledState::WAITING ? 20000U
        : state_ == OledState::FINISHED ? 30000U : 60000U;
    if (!sleeping_ && uint32_t(now - lastActivityAt_) >= timeout)
      sleeping_ = true;
  }

 private:
  OledState state_ = OledState::IDLE;
  uint32_t lastActivityAt_ = 0;
  bool sleeping_ = false;
  bool dirty_ = true;
};

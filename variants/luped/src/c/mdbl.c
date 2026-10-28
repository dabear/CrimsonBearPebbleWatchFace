#include <pebble.h>

// Luped asks for its own XS machine instead of the default 32 KB static block:
// with that block its slot heap was ~94% and its chunk heap ~87% full, so any
// new feature ran out of memory. Larger than the static block, the firmware
// takes these from the app heap (needs PebbleOS 4.21+, see PebbleOS #1621).
// Measured on a Pebble Time 2 (PebbleOS 4.41.2): slots ~50% and chunks ~41% used,
// with 28.7 KB of app heap left for PebbleOS; 64 KB in total also ran (16.4 KB left).
#define LUPED_XS_STACK (4 * 1024) // peak use 2.2 KB
#define LUPED_XS_SLOT (32 * 1024)
#define LUPED_XS_CHUNK (16 * 1024)

int main(void) {
  Window *window = window_create();
  window_stack_push(window, true);
  ModdableCreationRecord creation = {
    .recordSize = sizeof(creation),
    .stack = LUPED_XS_STACK,
    .slot = LUPED_XS_SLOT,
    .chunk = LUPED_XS_CHUNK,
    // Memory counters for scripts/build-release.sh --install; the firmware only
    // sends them while a log listener is connected.
#ifdef PBL_DEBUG
    .flags = kModdableCreationFlagLogInstrumentation | kModdableCreationFlagDebug
#else
    .flags = kModdableCreationFlagLogInstrumentation
#endif
  };
  moddable_createMachine(&creation);
  window_destroy(window);
  return 0;
}

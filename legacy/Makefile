
tst1: js/d1c3.c  Makefile
	emcc js/d1c3.c -sUSE_WEBGL2=1 -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2 \
-DNDEBUG -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=1400mb \
-o d1c3.js --pre-js js/ammo.js --pre-js js/CubicVR.js


all:  tst1
	echo 'Built 1ink.us Shaders.'

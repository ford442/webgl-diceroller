
tst1: d1c3.c  Makefile
	emcc d1c3.c -sUSE_WEBGL2=1 -sPRINTF_LONG_DOUBLE=1 -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2 \
-ffast-math -flto=thin -sSUPPORT_LONGJMP=0 -DNDEBUG -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=1400mb \
-O2 -o d1c3.js --pre-js js/ammo.js --pre-js js/CubicVR.js -sSUPPORT_BIG_ENDIAN=1


all:  tst1
	echo 'Built 1ink.us Shaders.'

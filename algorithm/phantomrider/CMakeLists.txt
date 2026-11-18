cmake_minimum_required(VERSION 3.16)
project(PhantomRiderPoolAlgo VERSION 0.1 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(phr_yp STATIC phr_yp.cpp)
target_include_directories(phr_yp PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

add_executable(phr_hash phr_hash.cpp)
target_link_libraries(phr_hash PRIVATE phr_yp)

add_executable(phr_yp_selftest phr_yp_selftest.cpp)
target_link_libraries(phr_yp_selftest PRIVATE phr_yp)

foreach(target phr_yp phr_hash phr_yp_selftest)
  if(MSVC)
    target_compile_options(${target} PRIVATE /O2 /W4)
  else()
    target_compile_options(${target} PRIVATE -O3 -Wall -Wextra -Wpedantic)
  endif()
endforeach()

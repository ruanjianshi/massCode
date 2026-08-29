---
contents:
  - id: 6
    label: main.cpp
    language: c_cpp
  - id: 7
    label: calc.hpp
    language: c_cpp
createdAt: 1787912000000
description: 多文件编译示例：main.cpp + calc.hpp 一起编译运行（含 stdin 输入演示）
folderId: 4
id: 10
isDeleted: 0
isFavorites: 0
name: 多文件示例_CPP
tags:
  - 1
updatedAt: 1787912000000
---

## Fragment: main.cpp
```c_cpp
#include "calc.hpp"
#include <iostream>
using namespace std;

int main() {
  int x, y;
  cout << "请输入两个整数: ";
  cin >> x >> y;
  cout << "sum = " << add(x, y) << endl;
  cout << "mul = " << mul(x, y) << endl;
  return 0;
}
```

## Fragment: calc.hpp
```c_cpp
#ifndef CALC_HPP
#define CALC_HPP
#define NUM 6

int add(int a, int b) { return a + b; }
int mul(int a, int b) { return a * b; }

#endif
```

---
contents:
  - id: 45
    label: main.tex
    language: latex
createdAt: 1788511095111
description: "LaTeX 工程：latex"
folderId: 25
id: 38
isDeleted: 0
isFavorites: 0
name: main
tags:
  - 28
updatedAt: 1788511095111
---

## Fragment: main.tex
```latex
\documentclass[UTF8,11pt]{ctexart}
\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{fontspec}
\graphicspath{{figures/}}

% 字体文件放入 fonts/ 后可启用，例如：
% \setmainfont[Path=fonts/]{YourFont.ttf}

\newif\ifhasreferences
\IfFileExists{data/references.bib}{%
  \hasreferencestrue
  \usepackage[backend=biber]{biblatex}
  \addbibresource{data/references.bib}
}{}

\title{LaTeX 工程}
\author{}
\date{\today}

\begin{document}
\maketitle

\section{开始}
在左侧编辑源码，右侧会实时生成 PDF。\\
如何引用图片，是一个重要的事情

\section{图片}
% 图片放入 figures/ 后取消下面一行注释：
\includegraphics[width=0.7\linewidth]{Two-wheelleg-robot.jpg}

\ifhasreferences
\nocite{*}
\printbibliography
\fi

\end{document}
```

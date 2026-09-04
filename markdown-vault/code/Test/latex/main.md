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
% 整体字号：[10pt|11pt|12pt]  值越大字越大，占页越多
\documentclass[10pt]{article}

\usepackage{hyperref}
\usepackage{xcolor}
\usepackage{calc}
\usepackage{graphicx}
\usepackage{tikz}
\usepackage{fontspec}
\usepackage{fontawesome5}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{fancybox}
\usepackage{everypage}

\AddEverypageHook{\headerfooter}

\hypersetup{hidelinks}

%%%%%%%%%%%%%%%%%%%
% 设置
%%%%%%%%%%%%%%%%%%%

\setlength{\parindent}{0pt}
\pagenumbering{gobble}
\setlist[itemize]{nosep
    , before={\vspace*{-\parskip}}
    , leftmargin=*}
\setlist[enumerate]{leftmargin=*}
\setlist[itemize,2]{label={},leftmargin=0pt,nosep,itemindent=0pt,labelsep=0pt,labelwidth=0pt}
% 行距系数：越大行距越大，内容越松散
\renewcommand{\arraystretch}{1.05}
% 行距：0.8=紧凑  1.0=正常  1.2=宽松
\linespread{0.93}

\titleformat{\section}
  {\Large\bfseries\raggedright}
  {}{0em}
  {}
  [{\color{secondary_color}\titlerule}]
% 标题间距：前*0.3ex / 后*0.2ex  数值越大间隔越大
\titlespacing*{\section}{0cm}{*0.3}{*0.2}

% 页边距：值越大空白越多，内容越少
\usepackage[
    a4paper,
    left=1cm,
    right=1cm,
    top=1.1cm,
    bottom=0.9cm,
    nohead
]{geometry}

% 字体设置
\setmainfont[
    Path=fonts/,
    Extension=.otf,
    BoldFont=*-Bold,
]{NotoSerifSC}

% 武科大配色
\definecolor{primary_color}{RGB}{0, 87, 63}
\definecolor{secondary_color}{RGB}{179, 163, 105}

\newlength{\iconwidth}
\setlength{\iconwidth}{1.2em}

% 允许中英混排时更灵活的断行，抑制 overfull
\tolerance=2000
\emergencystretch=3em
\hbadness=10000
\setlength{\hfuzz}{2pt}

%%%%%%%%%%%%%%%%%%%
% 自定义命令
%%%%%%%%%%%%%%%%%%%

\newcommand{\school}{机械工程学院 | School of Mechanical Engineering}

% 带图标的章节标题
\newcommand{\cvsection}[2]{%
    \section[#2]{\makebox[\iconwidth][c]{\color{primary_color}{#1}}\quad #2}%
}

% 经历条目：#1 机构/项目名  #2 角色  #3 时间
\newcommand{\cventry}[3]{%
    {\normalsize\textbf{#1}}，#2 \hfill #3\par
    % 条目后间距：越大条目间隔越大
    \vspace{0.15em}%
}

% 技能条目：#1 类别  #2 描述
\newcommand{\cvskill}[2]{\item \textbf{#1}：#2}

% ============================================================
% 间距控制（改大数值=增大间隔，改小=缩小间隔）
% ============================================================

% 条目间距：同一章节内不同项目之间的间隔
\newcommand{\entrygap}{\vspace{0.3em}}

% 章节间距：不同章节（如 教育背景→实习经历）之间的间隔
\newcommand{\sectiongap}{\vspace{0.5em}}

\newcommand{\contact}{
    \footnotesize
    \textcolor{white}{
        \faPhone \quad 15347348975
        \hspace{3em}
        \faEnvelope \quad \url{email:2408128687@qq.com}
        \hspace{3em}
        \faWeixin \quad 15096010804
    }
}

% 页眉页脚背景（多页共用） — 内容起始位置由 \vspace{} 控制，负值=上移
\newcommand{\headerfooter}{
    % 页眉
    \begin{tikzpicture}[remember picture, overlay]
        \node[anchor=north, inner sep=0pt](header) at (current page.north){
            \includegraphics[width=\paperwidth]{figures/header-darkgreen.png}
        };
        \node[anchor=west, yshift=-0.2cm](school_logo) at (header.west){
            \hspace{0.3cm}
            \includegraphics[width=0.3\textwidth]{figures/banner-white.png}
        };
        \node[anchor=east](school_name) at(header.east){
            \textcolor{white}{\textbf{\school}}
            \hspace{0.5cm}
        };
    \end{tikzpicture}
    % 页脚
    \begin{tikzpicture}[remember picture, overlay]
        \node[anchor=south, inner sep=0pt](footer) at (current page.south){
            \includegraphics[width=\paperwidth]{figures/footer-darkgreen.png}
        };
        \node[anchor=center] at(footer.center){\contact};
    \end{tikzpicture}
    % 背景水印
    \begin{tikzpicture}[remember picture, overlay]
        \node[opacity=0.04] at(current page.center){
            \includegraphics[width=0.6\paperwidth, keepaspectratio]{figures/logo.pdf}
        };
    \end{tikzpicture}
    \vspace{-1em}
}

\begin{document}

%%%%%%%%%%%%%%%%%%%
% 第一页
%%%%%%%%%%%%%%%%%%%
\headerfooter

\vspace{0.5em}   % 这里往下移动，数值越大下移越多
\begin{minipage}[t]{0.80\textwidth}
    % 个人信息
    \begin{minipage}[t]{\textwidth}
    \cvsection{\faAddressCard}{个人信息}

    \begin{minipage}[t]{0.48\textwidth}
        \textbf{姓\qquad 名}：肖琦

        \vspace{0.15em}
        \textbf{出生年月}：2002 年 11 月

        \vspace{0.15em}
        \textbf{籍\qquad 贯}：湖南衡阳

        \vspace{0.15em}
        \textbf{求职意向}：嵌入式/Linux开发
    \end{minipage}%
    \begin{minipage}[t]{0.48\textwidth}
        \textbf{性\qquad 别}：男

        \vspace{0.15em}
        \textbf{政治面貌}：中共党员

        % \vspace{0.15em}
        % \textbf{期望薪资}：13--17K

        \vspace{0.15em}
        \textbf{期望城市}：深圳、长沙
    \end{minipage}

\end{minipage}

\vspace{0.4em}   % 减小间隙

    % 教育背景
    \begin{minipage}[t]{\textwidth}
    \cvsection{\faGraduationCap}{教育背景}

    \cventry{武汉科技大学}{硕士 · 机械专业（专硕）}{2024.09 -- 2027.06}
    \begin{itemize}
        \item \textbf{研究方向}：智能机器人、控制算法、轮腿机器人、强化学习
        \item \textbf{综合排名}：5/176，\textbf{课程均分}：83.5
    \end{itemize}

    \entrygap
    \cventry{湖南工学院}{学士 · 机械设计制造及其自动化}{2020.09 -- 2024.06}
    \begin{itemize}
        \item \textbf{主修课程}：机械工程控制原理、数电与模电、单片机应用、机械设计与机械原理
        \item \textbf{班级排名}：1/43，\textbf{专业排名}：3/164
    \end{itemize}
    \end{minipage}
\end{minipage}%
\hfill
% 照片
\begin{minipage}[t]{0.175\textwidth}
    \vspace{0.8em}
    \setlength{\fboxsep}{0pt}
    \doublebox{\includegraphics[width=0.95\linewidth]{figures/amater.jpg}}
\end{minipage}

\sectiongap

% 工作经历
\begin{minipage}[t]{\textwidth}
\cvsection{\faBriefcase}{实习经历}

\cventry{武汉格蓝若智能技术股份有限公司}{嵌入式实习生 · 人形/四足机器人底层控制开发}{2025.11 -- 2026.06}
\begin{itemize}
    \item \textbf{主要工作：}主要参与人形机器人M2、四足机器人D1及货仓机器人的嵌入式系统研发，负责Linux驱动、STM32实时固件
                                    BMS电源管理及多协议通信的开发与调试，实习期间独立完成4个关键模块的交付。
    \item \textbf{项目一:}基于Linux的人形机器人关节电机驱动开发  
    \item \textbf{技术栈:}RK3588 / 多线程 / C++ / PCIe-to-CAN / EtherCAT / CANopen(SDO) / RS485 / ROS2
    \item \textbf{工作与成果}：\hfill {\textbf{负责：}自研电机，卓誉关节电机，达妙电机等}
    \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
        \item 1.\hspace{0.3em}硬件链路层：M.2接口实现PCIe至六路CAN的协议转换与信号适配，然后通过CAN分析仪进行长时间满载数据抓包
                                        与回环压力测试。
        \item 2.\hspace{0.3em}驱动与中间件移植：先基于Makefile完成单电机驱动原型验证；后将驱动架构完整移植至ROS2框架，采用CMake
                                            重构工程，实现六路CAN总线的多线程并发控制，并封装标准化服务/话题接口，实现与算法部门的无缝对接。
        \item 3.\hspace{0.3em}协议栈解析：解析电机私有协议，基于CANopen协议规范（SDO/PDO）构建电机对象字典模型，完整支持位置、
                                        速度、力矩、MIT（阻抗） 及回零五种控制模式，并开放参数在线修改与故障诊断接口。
    \end{itemize}

    \item \textbf{项目二:}六维力传感器高精度数据采集系统（STM32 + EtherCAT）  
    \item \textbf{技术栈:}STM32F4 / HAL库 / RTOS / SPI / SIG5632/34/MAX11254 / EtherCAT（AX58100）/ CANFD
    \item \textbf{工作与成果}：\hfill {\textbf{负责：}驱动、滤波、adc -> 力解析等}
    \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
        \item 1.\hspace{0.3em}高精度采样实现：使用STM32CUBEMX配置HAL库，驱动SPI接口的SIG5632/34芯片，配置PGA可编程增益放大器
                                            与Σ-Δ调制器，实现6路高精度高速adc采样，将采用数据通过力矩阵解析为六维力信号的32位高精度数字输出，通过IO
                                            外部中断触发同步采样。
        \item 2.\hspace{0.3em}实时工业以太网：AX58100（EtherCAT从站控制器）与STM32的通信机制，将ADC采集的力/力矩数据打包映射至
                                        EtherCAT过程数据对象（PDO），实现了与上位机主站实时数据交互。
    \end{itemize}

    \item \textbf{项目三:}货仓机器人底盘控制与末端执行器驱动开发
    \item \textbf{技术栈:}STM32 / RS485/CAN / 霍尔编码器 / PID / MOSFET/栅极驱动
    \item \textbf{工作与成果}：\hfill {\textbf{负责：}底盘驱动、末端驱动，协议适配等}
    \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
        \item 1.\hspace{0.3em}升降立柱控制：机器人下半身控制，一是网线端水晶头连接实现按键控制与调试，二是上位端RS485通信控制，实现
                                        与机器人大脑连接节点发布订阅控制。
        \item 2.\hspace{0.3em}双臂末端执行器开发：实现电推杆夹取与气泵吸盘两种抓取模式，针对轻小物体优化吸盘控制逻辑。
    \end{itemize}

    \item \textbf{项目四:}双足/四足机器人BMS电源板管理与状态机设计
    \item \textbf{技术栈:}STM32 / 状态机设计 / 多级优先级调度 / CAN/RS485/USART / 远程控制 / bootloader(OTA)
    \item \textbf{工作与成果}：\hfill {\textbf{负责：}M2、D1电源板控制、BMS管理等}
    \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
        \item 1.\hspace{0.3em}电源系统设计：针对人形机器人M2和机器狗D1设计双电池冗余管理方案，集成过压/欠压保护、泄压电路及刹车能
                                        量泄放电路；通过3路RS485、2路CAN及1路USART实时监测电池电量、温度、电流及电压
                状态。
        \item 2.\hspace{0.3em}三级安全控制策略：定义硬件急停（最高优先级）、远程RF遥控急停与上位软件指令的优先级仲裁机制。
        \item 3.\hspace{0.3em}状态机（FSM）实现：初始化 → 安全 → 就绪 → 上电 的主流程，并处理急停/故障到安全/就绪的异常跳
                转与复位逻辑，软件指令（A/B/C键）与远程命令协同控制电源上下电。

    \end{itemize}

    \item \textbf{项目链接}：\url{https://github.com/ruanjianshi/motor-drive_power-board_six-force}
\end{itemize}


% 专业技能
\vspace{0.1em} 
\cvsection{\faWrench}{专业技能}

\begin{itemize}
\setlength{\itemsep}{0.15em}
    \cvskill{嵌入式开发}{熟练 STM32（固件库 / HAL）、ESP32、FreeRTOS，RTthread, LVGL, Tessy}
    \cvskill{Linux 开发}{应用编程、多线程、makefile / cmake、gdb、UDP / TCP、MQTT}
    \cvskill{通信协议}{USART、SPI、I\textsuperscript{2}C、RS485、CANopen、CAN FD、EtherCAT、LIN、UDS}
    \cvskill{电机驱动}{无刷 FOC 与滤波，位置 / 速度 / 电流环 PID，MIT 力位混合控制}
    \cvskill{机器人系统}{ROS1 / ROS2、Gazebo / Webots 仿真、SLAM、YOLO、MoveIt}
    \cvskill{机器人算法}{LQR、MPC、VMC、ADP；SAC / PPO 等强化学习，sim2sim / sim2real}
    \cvskill{工具与平台}{Isaac Gym / MuJoCo / UniLab；嘉立创 EDA / AD（PCB）、AutoCAD、SolidWorks}
    \cvskill{编程语言}{C / C++（STL）、Python、MATLAB（Simulink 仿真）}
\end{itemize}

% 社团与实验室经历
\begin{minipage}[t]{\textwidth}
\cvsection{\faUsers}{社团与实验室经历}

\cventry{智能制造协会}{会长 · 协会创立与全面管理}{2022.06 -- 2023.09}
\cventry{机械创新实验室}{负责人 · 嵌入式培训与带队竞赛}{2021.06 -- 2024.06}
\cventry{魔术协会}{技术部成员}{2020.11 -- 2021.06}
\end{minipage}

\end{minipage}


\sectiongap


\sectiongap

% 项目经历（首页）
\begin{minipage}[t]{\textwidth}

\vspace{0.3em}   % 或您想要的数值，让第二页内容整体下移
\cvsection{\faFlask}{项目经历}

\cventry{小型人形机器人开发}{主控负责}{2026.06 -- 2026.09}
\begin{itemize}
    \item \textbf{主要工作：}聚焦于高约0.8m、22自由度人形机器人全栈开发，涵盖结构设计、ROS2控制、强化学习训练与sim2real实机
                            部署，实现从仿真到实机的完整闭环。

    \item \textbf{技术栈：}RDK5 / ROS2 / CANFD / 高擎HTDW(MIT) / Isaac Gym(PPO)→ONNX→RKNN / MuJoCo

    \item \textbf{工作与成果：}\hfill {\textbf{负责：}结构、控制、训练与部署}
    \begin{itemize}[label=-, leftmargin=0.8em, labelsep=0.5em]
        \item 1.\hspace{0.3em}底层控制：编写HTDW电机ROS2驱动（MIT力位混合模式），实现CANFD多节点通信（4路CANFD，每路挂5到7
                                    个电机）；完成IMU数据采集（USB2USART）及姿态解算。
        \item 2.\hspace{0.3em}强化学习训练：Isaac Gym+PPO进行步态训练，设计奖励函数，策略输出.pt→ONNX→RKNN部署，并在MuJoCo
                                        中完成sim2sim验证与参数调优。
    \end{itemize}

    \item \textbf{项目链接：}\url{https://github.com/ruanjianshi/humanrobot_ros2_sim2real}
\end{itemize}


\entrygap
\cventry{四连杆两轮腿机器人开发设计（轮+足）}{独立开发}{2026.01 -- 2026.09}
\begin{itemize}
    \item \textbf{主要工作：}聚焦于大型四连杆机构轮腿机器人全栈开发，具备轮/足切换功能，完成从结构设计、四层自制板卡（Jetson Nano拓展板+DCU+BMS）、ROS1控制、UniLab强化学习训练到sim2real实机部署的完整闭环。

    \item \textbf{技术栈：}Jetson Nano / ROS1 / EtherCAT转CANFD(5M) / 四层自制板卡(BMS+DCU) / UniLab(PPO) / MuJoCo仿真 / 智元R86/R52电机 / 轻量化连杆结构

    \item \textbf{工作与成果：}\hfill {\textbf{负责：}结构、硬件、控制、训练与部署}
    \begin{itemize}[label=-, leftmargin=0.8em, labelsep=0.5em]
        \item 1.\hspace{0.3em}结构设计：完成整机SolidWorks建模、URDF导出、STL优化与碰撞简化，足端可拆卸设计，膝关节从不完全齿轮+
                                        连杆替代丝杆驱动，提升响应速度；外壳3D打印+机加工骨架，集成7寸屏幕、雷达与RGB-D相机。
        \item 2.\hspace{0.3em}硬件系统：设计四层叠板架构（JetsonNano核心板+自制拓展板（供电/DC-DC/SPI转RS485/CAN）+DCU（Ether
                                        CAT转4路CANFD，5Mbps）+ BMS电源板（过/欠压保护、泄放、急停与遥控））。
        \item 3.\hspace{0.3em}底层控制：编写智元R86/R52电机ROS1驱动（MIT力位混合模式），实现EtherCAT→CANFD协议栈与IMU数据采
                                        集（USB2USART），定义话题/服务接口。
        \item 4.\hspace{0.3em}强化学习与部署：基于UniLab+PPO进行步态训练并设计奖励函数，策略输出.pt→ONNX，MuJoCo做sim2sim验证
                                        完成sim2real实机迁移（输入42维→输出8维，乘action\_scale），调试PD参数、电机ID与零点校准。
    \end{itemize}

        \item \textbf{项目链接：}%
        \mbox{\url{https://github.com/ruanjianshi/wheel_legged_RL_unilab\\Jetson_nano_X1\\stm32-trolley}}
        
    
%\item \textbf{项目链接：}\url{https://github.com/ruanjianshi/wheel_legged_RL_unilab}（强化学习算法）\\
%       \hspace*{5.0em}\url{https://github.com/ruanjianshi/Jetson_nano_X1}（上层驱动）\\
%      \hspace*{5.0em}\url{https://github.com/ruanjianshi/Wheel-leg-ros2-and-stm32-trolley}（底层驱动）
\end{itemize}

\entrygap
\cventry{基于STM32和OpenMV的智能物流小车}{主控代码撰写}{2025.08 -- 2025.09}
\begin{itemize}
    \item \textbf{主要工作：}设计并实现一款高度自主运行的物流小车，涵盖麦克纳姆轮底盘搭建、机械臂抓取机构组装、电机驱动/超声波
                            避障/蓝牙通讯/视觉识别硬件架构搭建，以及自动分拣与路径规划软件逻辑开发。

    \item \textbf{技术栈：}STM32F407 / FreeRTOS / 麦克纳姆轮运动学 / 520编码电机 / OpenMV4(颜色/形状识别) / UART通信 / 超声波避障

    \item \textbf{工作与成果：}\hfill {\textbf{负责：}硬件选型、主控代码、视觉算法}
    \begin{itemize}[label=-, leftmargin=0.8em, labelsep=0.5em]
        \item 1.\hspace{0.3em}硬件选型与搭建：选用麦克纳姆轮底盘+4个520直流编码电机；STM32F407作为主控；42步进电机驱动滑轨升降，舵
                                            机控制云台旋转与夹爪张合；超声波测距避障；OpenMV4 H7 Plus视觉识别，预留蓝牙调试接口。
        \item 2.\hspace{0.3em}主控软件：基于STM32固件库与FreeRTOS实时操作系统，编写小车全自动控制流程（路径规划→视觉识别→抓取→
                                    搬运→释放）。
        \item 3.\hspace{0.3em}视觉识别算法：基于OpenMV4实现颜色识别（红/蓝/绿/灰/黄）与形状识别（五角星/三角形/正方形/矩形），以及颜
                                            色区域识别，通过UART串口与底盘双向通信，实现物料自动分拣。
    \end{itemize}

    \item \textbf{项目链接：}\url{https://github.com/ruanjianshi/Table-trolley}
\end{itemize}


\entrygap
\cventry{基于车灯控制的MCU开发项目}{车灯控制器}{2025.06 -- 2025.09}
\begin{itemize}
    \item \textbf{主要工作：}参与多款车灯控制器（前组合灯/氛围灯）的应用开发，涵盖应用层逻辑设计、底层驱动调试（SPI/CAN/
                            LIN）、tessy测试、灯光联调。前组合灯平台项目交付，同步参与（CANFD升级平台）与（氛围灯）。
        \item \textbf{项目一:}前组合灯控制器、内饰氛围灯  
        \item \textbf{技术栈:}YTM32B1MC03/MD24（Cortex-M33）｜ GD32A503RC｜ AUTOSAR ｜ CAN / CANFD / LIN｜ UDS｜ SPI｜  IAR / CMake
\item \textbf{工作与成果}：\hfill {\textbf{负责：}灯光控制、应用层开发等}
        \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
            \item 1.\hspace{0.3em}灯光逻辑调度：前组合灯（近光/远光/转向/日行/雾灯/LOGO等）控制策略设计，在20ms硬实时周期内完成"信号
                                            解析→优先级仲裁→驱动输出→状态回发"完整闭环。针对平台扩展至5种灯语与ADS自适应大灯互斥逻辑，并新增
                                            档位电机控制。
            \item 2.\hspace{0.3em}电源与热管理：5态电压滞回监控策略，结合电压/NTC双路降额算法，在车载电源波动或LED过热时主
                    动降额保护
            \item 3.\hspace{0.3em}恒流驱动开发：驱动BOOST升压+2路Buck降压恒流拓扑（SPI四通道），编写40ms周期故障巡检任务，通过回读输
                                            出电压精准判断开路（30~34V阈值）。
            \item 4.\hspace{0.3em}一版固件兼容左右灯:GPIO\_LR 识别 + 运行时动态切换诊断地址（RX 0x721/0x732、TX 0x7A1/0x7B2）
                    与状态/DTC 报文 ID（0x420/0x421、0x4BC/0x4BD）。
        \end{itemize}
\end{itemize}

\end{minipage}


\vspace{0.1em} 

% 荣誉证书（通栏双列）
\begin{minipage}[t]{\textwidth}
\cvsection{\faTrophy}{荣誉证书}

\begin{minipage}[t]{0.485\textwidth}
    \textbf{研究生阶段}
    \begin{itemize}[nosep]
        \item 研究生学业奖学金一等奖（2024、2025）
        \item 睿抗机器人开发者大赛国二等奖（负责人）
        \item 睿抗 ROS 机器人挑战赛省二等奖（负责人）
        \item 三维数字化创新设计大赛省一等奖（负责人）
        \item 高校机器人创意大赛省二 / 省三等奖
        \item 兼职辅导员（2024.09 -- 2025.07）
    \end{itemize}
\end{minipage}%
\hfill
\begin{minipage}[t]{0.485\textwidth}
    \textbf{本科阶段}
    \begin{itemize}[nosep]
        \item 湖南省物联网设计大赛一等奖
        \item 湖南省机械创新设计大赛二等奖
        \item 湖南省工程实践与创新能力大赛三等奖
        \item 国家级大创项目负责人
        \item 校级一等奖学金、校级优秀毕业生
    \end{itemize}
\end{minipage}
\end{minipage}

\vspace{0.1em} 

% 资格证书 / 个人格言
\begin{minipage}[t]{0.485\textwidth}
    \cvsection{\faIdCard}{资格证书}
    \begin{itemize}[nosep]
        \item 大学英语六级（CET-6）、四级（CET-4）
        \item 计算机二级、驾驶证 C1
    \end{itemize}
\end{minipage}%
\hfill
\begin{minipage}[t]{0.485\textwidth}
    \cvsection{\faStar}{个人格言}
    \begin{itemize}[nosep]
        \item 热爱技术，无限进步
        \item \footnotesize Passion for tech. Progress without limits.
    \end{itemize}
\end{minipage}

\end{document}
```

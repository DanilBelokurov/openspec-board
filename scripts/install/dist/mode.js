"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectInstallMode = selectInstallMode;
const prompts_1 = require("./prompts");
const print_1 = require("./print");
const MODE_OPTIONS = [
    { label: "Аналитик/разработчик", value: "analyst-developer" },
    { label: "Эксперт УЭК", value: "uek-expert" },
];
async function selectInstallMode(nonInteractive, override) {
    if (override) {
        print_1.print.success(`Выбран режим установки: ${override}`);
        return override;
    }
    if (nonInteractive) {
        return "analyst-developer";
    }
    print_1.print.section("◉", "Режим работы доски");
    const value = await (0, prompts_1.selectArrowOption)("В каком режиме установить доску sdd?", 0, MODE_OPTIONS);
    print_1.print.success(`Выбран режим установки: ${value}`);
    return value;
}

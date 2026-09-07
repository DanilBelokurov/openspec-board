import { selectArrowOption } from "./prompts";
import type { InstallMode } from "./constants";
import { print } from "./print";

const MODE_OPTIONS = [
  { label: "Аналитик/разработчик", value: "analyst-developer" as const },
  { label: "Эксперт УЭК", value: "uek-expert" as const },
];

export async function selectInstallMode(
  nonInteractive: boolean,
  override?: InstallMode,
): Promise<InstallMode> {
  if (override) {
    print.success(`Выбран режим установки: ${override}`);
    return override;
  }
  if (nonInteractive) {
    return "analyst-developer";
  }
  print.section("Режим работы доски");
  const value = await selectArrowOption(
    "В каком режиме установить доску sdd?",
    0,
    MODE_OPTIONS,
  );
  print.success(`Выбран режим установки: ${value}`);
  return value as InstallMode;
}
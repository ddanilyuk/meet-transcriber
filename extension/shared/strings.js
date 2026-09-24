// Ukrainian UI strings.
(function (root) {
  const MT = (root.MT = root.MT || {});

  MT.t = {
    appName: 'Meet Transcriber',
    panelTitle: 'Транскрипт',
    openPanel: 'Транскрипт',
    closePanel: 'Закрити',
    statusRecording: 'Запис',
    statusWaiting: 'Очікування субтитрів',
    statusCaptionsOff: 'Субтитри вимкнено',
    statusEnded: 'Завершено',
    since: 'з',
    now: 'зараз',
    searchPlaceholder: 'Пошук у транскрипті',
    searchCount: (n) => `${n} збіг${n % 10 === 1 && n % 100 !== 11 ? '' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'и' : 'ів'}`,
    searchNone: 'Нічого не знайдено',
    newReplies: 'Нові репліки',
    you: 'Ви',

    emptyTitle: 'Поки що тиша',
    emptyText: 'Репліки зʼявляться тут, щойно хтось заговорить.',
    offTitle: 'Субтитри вимкнено',
    offText: 'Транскрипт записується з субтитрів Meet. Увімкніть їх, щоб продовжити запис.',
    offAction: 'Увімкнути субтитри',
    notFoundTitle: 'Не вдається знайти субтитри',
    notFoundText: 'Можливо, Google Meet змінив інтерфейс. Спробуйте вимкнути й знову ввімкнути субтитри.',
    searchEmptyTitle: 'Нічого не знайдено',
    searchEmptyText: 'Спробуйте інше слово або імʼя.',

    langBannerTitle: 'Мова субтитрів не українська',
    langBannerText: (lang) => `Зараз Meet розпізнає мову як «${lang}». Щоб транскрипт був точним, оберіть українську.`,
    langBannerAction: 'Обрати українську',
    langBannerDismiss: 'Не зараз',
    reloadBannerTitle: 'Розширення оновлено',
    reloadBannerText: 'Перезавантажте сторінку, щоб продовжити запис.',

    overlayToggle: 'Субтитри на екрані',
    copy: 'Копіювати транскрипт',
    download: 'Завантажити',
    archive: 'Архів мітингів',
    settings: 'Налаштування',
    copied: 'Транскрипт скопійовано',
    downloaded: 'Файл збережено в «Завантаження»',
    formatMd: 'Markdown (.md)',
    formatTxt: 'Текст (.txt)',
    formatJson: 'JSON (.json)',
    downloadAs: 'Завантажити як',

    settingAutoCaptions: 'Автоматично вмикати субтитри',
    settingAutoCaptionsHint: 'Під час входу в мітинг',
    settingAutoUkrainian: 'Ставити українську мову',
    settingAutoUkrainianHint: 'Мова розпізнавання в Meet',
    settingAutoDownload: 'Зберігати файл після мітингу',
    settingAutoDownloadHint: 'Завантаження / Meet Transcripts',
  };
})(globalThis);

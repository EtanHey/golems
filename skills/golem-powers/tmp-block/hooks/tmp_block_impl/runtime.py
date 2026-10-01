"""One live callback record in each canonical-path implementation package."""


class Runtime:
    def bind(self, classify_temp, temp_prefixes):
        self._classify_temp = classify_temp
        self._temp_prefixes = temp_prefixes

    def classify_temp(self, raw):
        return self._classify_temp(raw)

    def temp_prefixes(self):
        return self._temp_prefixes()


callbacks = Runtime()

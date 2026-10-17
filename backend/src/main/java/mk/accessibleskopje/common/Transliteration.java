package mk.accessibleskopje.common;

import java.text.Normalizer;
import java.util.Map;

/**
 * Macedonian Cyrillic to Latin transliteration and search normalisation.
 * Mirrors {@code data-pipeline/pipeline/translit.py}; keep both in sync.
 */
public final class Transliteration {

    private static final Map<Character, String> MK = Map.ofEntries(
            Map.entry('а', "a"), Map.entry('б', "b"), Map.entry('в', "v"), Map.entry('г', "g"),
            Map.entry('д', "d"), Map.entry('ѓ', "gj"), Map.entry('е', "e"), Map.entry('ж', "zh"),
            Map.entry('з', "z"), Map.entry('ѕ', "dz"), Map.entry('и', "i"), Map.entry('ј', "j"),
            Map.entry('к', "k"), Map.entry('л', "l"), Map.entry('љ', "lj"), Map.entry('м', "m"),
            Map.entry('н', "n"), Map.entry('њ', "nj"), Map.entry('о', "o"), Map.entry('п', "p"),
            Map.entry('р', "r"), Map.entry('с', "s"), Map.entry('т', "t"), Map.entry('ќ', "kj"),
            Map.entry('у', "u"), Map.entry('ф', "f"), Map.entry('х', "h"), Map.entry('ц', "c"),
            Map.entry('ч', "ch"), Map.entry('џ', "dzh"), Map.entry('ш', "sh"),
            Map.entry('ђ', "dj"), Map.entry('ћ', "c"), Map.entry('й', "j"), Map.entry('ы', "y"),
            Map.entry('э', "e"), Map.entry('ю', "ju"), Map.entry('я', "ja"), Map.entry('щ', "shch"),
            Map.entry('ъ', ""), Map.entry('ь', ""), Map.entry('ё', "jo"));

    private Transliteration() {
    }

    public static String toLatin(String text) {
        StringBuilder sb = new StringBuilder(text.length());
        for (char ch : text.toCharArray()) {
            char low = Character.toLowerCase(ch);
            String rep = MK.get(low);
            if (rep == null) {
                sb.append(ch);
            } else if (ch != low && !rep.isEmpty()) {
                sb.append(Character.toUpperCase(rep.charAt(0))).append(rep, 1, rep.length());
            } else {
                sb.append(rep);
            }
        }
        return sb.toString();
    }

    public static String normalizeForSearch(String text) {
        String t = toLatin(text.toLowerCase());
        t = Normalizer.normalize(t, Normalizer.Form.NFKD).replaceAll("\\p{M}", "");
        StringBuilder sb = new StringBuilder(t.length());
        for (char ch : t.toCharArray()) {
            sb.append(Character.isLetterOrDigit(ch) ? ch : ' ');
        }
        return sb.toString().trim().replaceAll("\\s+", " ");
    }
}

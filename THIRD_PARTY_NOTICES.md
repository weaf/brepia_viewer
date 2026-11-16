# Third-party notices

## Upstream provenance

Brepia is based on and evolved from the open-source CADAM project by Adam-CAD. Brepia retains portions of its code, design and architectural lineage. The upstream project is available at <https://github.com/Adam-CAD/CADAM>.

The repository is distributed under the GNU General Public License v3.0; see [`LICENSE`](LICENSE). This notice supplements, and does not replace, the copyright and license notices required by the applicable source files and upstream distributions.


## Notydesign C snap-fit geometry

The Experimental chain generator embeds an adapted copy of
[`link/C_kulled_snappfaste.scad`](https://github.com/Noty-design/Parametric-designs/blob/main/link/C_kulled_snappfaste.scad)
from [Noty-design/Parametric-designs](https://github.com/Noty-design/Parametric-designs).
The original source identifies Notydesign as its designer and states the
**Creative Commons Attribution–NonCommercial–ShareAlike 4.0 International**
license ([CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)).

The bundled geometry lives in `src/lib/chainGenerator/cSource.ts` with
source attribution. It preserves the original joint dimensions, except for
exposing the existing socket-fit choice per segment. Exported standalone SCAD
files also retain the original source header and license attribution.
This notice does not purport to relicense the source geometry under GPL-3.0.

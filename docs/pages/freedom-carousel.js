document.addEventListener("DOMContentLoaded", function () {
    const carouselTrack = document.getElementById("carousel-track");
    if (!carouselTrack) return;

    // Original (base) images, no clones
    const baseImages = Array.from(carouselTrack.children);

    let positionX = 0;
    let loopWidth = 0;

    const baseSpeed  = 1;    // smooth default
    const hoverSpeed = 2.6;  // faster on hover
    let currentSpeed = baseSpeed;
    let targetSpeed  = baseSpeed;
    let scrollDirection = -1; // left by default
    let animationFrame = null;
    let isHovering = false;

    function buildStrip() {
        // Reset track to only the base images
        carouselTrack.innerHTML = "";
        baseImages.forEach(img => carouselTrack.appendChild(img));

        const viewport = carouselTrack.parentElement;
        const minStrip = (viewport?.clientWidth || window.innerWidth) * 2;

        // Measure width of ONE full set
        loopWidth = carouselTrack.scrollWidth;

        // Clone base images as many times as needed to be comfortably wide
        while (carouselTrack.scrollWidth < minStrip) {
            baseImages.forEach(img => {
                const clone = img.cloneNode(true);
                clone.setAttribute("aria-hidden", "true");
                carouselTrack.appendChild(clone);
            });
        }
    }

    function updateScroll() {
        // ease toward the target speed
        currentSpeed += (targetSpeed - currentSpeed) * 0.07;

        positionX += scrollDirection * currentSpeed;

        // wrap in a seamless loop of width = one base set
        if (scrollDirection === -1 && positionX <= -loopWidth) {
            positionX += loopWidth;
        } else if (scrollDirection === 1 && positionX >= 0) {
            positionX -= loopWidth;
        }

        carouselTrack.style.transform = `translate3d(${positionX}px, 0, 0)`;
        animationFrame = requestAnimationFrame(updateScroll);
    }

    function startAutoScroll() {
        if (!animationFrame) animationFrame = requestAnimationFrame(updateScroll);
    }

    function startHoverScroll(direction) {
        if (!isHovering) {
            isHovering = true;
            scrollDirection = direction;
            targetSpeed = hoverSpeed;
        }
    }

    function stopHoverScroll() {
        if (isHovering) {
            isHovering = false;
            targetSpeed = baseSpeed * 0.8; // coast
            setTimeout(() => { targetSpeed = baseSpeed; }, 300);
        }
    }

    // Initialize after images are ready
    function initializeCarousel() {
        const images = baseImages;
        const allComplete = images.every(img => img.complete);

        const go = () => {
            buildStrip();
            startAutoScroll();
        };

        if (allComplete) {
            go();
        } else {
            let loaded = 0;
            images.forEach(img => {
                img.addEventListener("load", () => {
                    loaded++;
                    if (loaded === images.length) go();
                }, { once: true });
                img.addEventListener("error", () => {
                    loaded++;
                    if (loaded === images.length) go();
                }, { once: true });
            });

            // safety: if some never fire, still start after a delay
            setTimeout(() => {
                if (!animationFrame) go();
            }, 800);
        }
    }

    initializeCarousel();

    // Hover zones
    const leftZone  = document.querySelector(".left-zone");
    const rightZone = document.querySelector(".right-zone");
    if (leftZone && rightZone) {
        leftZone.addEventListener("mouseenter", () => startHoverScroll(1));
        rightZone.addEventListener("mouseenter", () => startHoverScroll(-1));
        leftZone.addEventListener("mouseleave", stopHoverScroll);
        rightZone.addEventListener("mouseleave", stopHoverScroll);
    }

    // Recompute on resize (resets strip, which is fine)
    let resizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            positionX = 0;
            buildStrip();
        }, 150);
    });
});
